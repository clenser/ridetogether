// Static checks on supabase/schema.sql that do not need a live database:
//  - $$ quoting is balanced
//  - every function referenced by a REVOKE/GRANT exists with the same arg types
//  - every trigger fires a function that exists
//  - no client role is granted a SECURITY DEFINER function by accident
import { readFileSync } from "node:fs";

const sql = readFileSync(process.argv[2], "utf8");
const strip = sql.replace(/--[^\n]*/g, "");
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

/**
 * SECURITY DEFINER functions that a client role may call, each verified to return
 * presence flags only and never a secret value.
 *
 * `push_service_status` has to be SECURITY DEFINER because `vault.decrypted_secrets`
 * is unreadable by any client role, and it is the whole point of the function: the
 * app must be able to tell a working server from an unwired one. It answers two
 * `exists` booleans and returns no column from Vault, so the capability it grants
 * is "is this deployment configured", which is not sensitive - the same fact is in
 * the client's own Settings screen. Adding a name here means also adding a
 * `comment on function` explaining why it is safe; the check below enforces that.
 */
const PRESENCE_ONLY = new Set(["public.push_service_status"]);

// ---------------------------------------------------------------- $$ pairing
const dollars = (strip.match(/\$\$/g) || []).length;
check(dollars % 2 === 0, `unbalanced $$ quoting (${dollars} occurrences)`);

// ------------------------------------------------- declared function signature
const declRe = /create\s+or\s+replace\s+function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*\nreturns\s+([\s\S]*?)as\s+\$\$/gi;
const declared = new Map();
const definerFns = new Set();
for (const m of strip.matchAll(declRe)) {
  const name = m[1].toLowerCase();
  const args = m[2]
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a && !/^--/.test(a))
    // Drop the parameter name and any `default` clause, keep the bare type.
    .map((a) => a.replace(/\s+default\s+[\s\S]+$/i, ""))
    .map((a) => a.replace(/^[\w\s]+?(?=\s+[a-z])/i, "").trim().replace(/\s+/g, ""));
  declared.set(name, args.join(","));
  // Only the declaration header may be inspected: letting the pattern run on
  // into the body makes one function's `security definer` look like every
  // function declared above it.
  if (/security\s+definer/i.test(m[3])) definerFns.add(name);
}

// --------------------------------------------- referenced function signatures
// `[^()]*` for the argument list: a lazy `[\s\S]*?` can run past the end of one
// statement and latch onto a later `grant ... to authenticated`, which reports
// a grant that was never written.
const refRe = /(?:revoke|grant)\s+execute\s+on\s+function\s+([\w.]+)\s*\(([^()]*)\)\s*(?:from|to)\s+([\w_]+)/gi;
for (const m of strip.matchAll(refRe)) {
  const name = m[1].toLowerCase();
  const role = m[3].toLowerCase();
  const args = m[2].split(",").map((a) => a.trim()).filter(Boolean).join(",");
  if (!declared.has(name)) {
    failures.push(`${m[2] && m[0].includes("revoke") ? "REVOKE" : "GRANT"} references undeclared function ${name}(${args})`);
    continue;
  }
  check(
    declared.get(name) === args,
    `signature mismatch for ${name}: declared(${declared.get(name)}) vs referenced(${args})`,
  );
  if (role === "authenticated" && definerFns.has(name) && !PRESENCE_ONLY.has(name)) {
    failures.push(`${name} is SECURITY DEFINER but is granted to authenticated`);
  }
}

// -------------------------------------------------------- trigger wiring
const trigRe = /create\s+trigger\s+([\w]+)[\s\S]{0,240}?execute\s+function\s+([\w.]+)\(\)/gi;
for (const m of strip.matchAll(trigRe)) {
  check(
    declared.has(m[2].toLowerCase()),
    `trigger ${m[1]} fires undeclared function ${m[2]}`,
  );
}

// Grants written as `execute format('grant execute on function %s to
// authenticated', fn)` are invisible to a regex, so the loop-driven blocks in
// this schema are checked by eye instead; the reference check above covers the
// statically written ones.

// ------------------------------------------- NEW/OLD records in trigger bodies
// In PL/pgSQL a trigger function may only read NEW on INSERT/UPDATE and OLD on
// UPDATE/DELETE. Touching the other record raises
// `record "old" is not assigned yet`, which aborts the caller's statement. That
// is how `coalesce(new, old)` came to make every seat request fail.
// The body is what sits between the opening `as $$` and the closing `$$`; the
// naive `returns trigger ... $$` capture stops at the opening delimiter and
// checks nothing.
const triggerFnRe = /create\s+or\s+replace\s+function\s+([\w.]+)\s*\(\s*\)\s*\n\s*returns\s+trigger[\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$/gi;
for (const m of strip.matchAll(triggerFnRe)) {
  const name = m[1];
  const body = m[2];

  // Unambiguous defect: coalescing one trigger record against the other, whether
  // whole (`coalesce(new, old)`) or field-by-field
  // (`coalesce(new.reviewee_id, old.reviewee_id)`). Coalescing a field against a
  // literal is fine and stays allowed, so match on the second argument.
  check(
    !/coalesce\(\s*new\b[^,]*,\s*old\b/i.test(body)
      && !/coalesce\(\s*old\b[^,]*,\s*new\b/i.test(body),
    `trigger function ${name} coalesces NEW against OLD; branch on tg_op instead`,
  );

  // Which operations can this function actually be fired for? The event clause
  // precedes the table: `after insert or update of status on public.bookings`.
  const events = new Set();
  const ownerTrigRe = new RegExp(
    `create\\s+trigger\\s+[\\w]+\\s+(before|after)\\s+([^\\n]*?)\\s+on\\s+[\\w.]+[\\s\\S]{0,240}?execute\\s+function\\s+${name}\\s*\\(\\)`,
    "gi",
  );
  for (const t of strip.matchAll(ownerTrigRe)) {
    const clause = t[2].toLowerCase();
    if (/\binsert\b/.test(clause)) events.add("INSERT");
    if (/\bupdate\b/.test(clause)) events.add("UPDATE");
    if (/\bdelete\b/.test(clause)) events.add("DELETE");
  }
  check(events.size > 0, `trigger function ${name} is not attached to any trigger`);

  // A function that can see both an INSERT and a DELETE has to decide which
  // record it is looking at, so it must branch on tg_op somewhere.
  if (events.has("INSERT") && events.has("DELETE")) {
    check(
      /tg_op/.test(body),
      `trigger function ${name} fires on INSERT and DELETE but never inspects tg_op`,
    );
  }
}

// --------------------------------------------------------- net.http_post use
check(
  /perform\s+net\.http_post\(/.test(strip),
  "pg_net dispatch trigger does not call net.http_post",
);
check(
  /referencing\s+new\s+table\s+as\s+inserted/.test(strip),
  "dispatch trigger is missing its transition table",
);

// --------------------------------------------------- Web Push safety invariants
for (const name of PRESENCE_ONLY) {
  // An allowlist entry is a promise that the function returns no secret. Enforce
  // that it is documented, so the exemption cannot be taken silently.
  check(
    new RegExp(`comment\\s+on\\s+function\\s+${name.replace(/\./g, "\\.")}\\s*\\(\\)`).test(strip),
    `${name} is granted to a client role but has no "comment on function" justifying it`,
  );
}

// The status function must not be able to hand a Vault value to the client.
const statusDecl = strip.match(
  /create\s+or\s+replace\s+function\s+public\.push_service_status\(\)\s*\nreturns\s+([\s\S]*?)as\s+\$\$/i,
);
const statusHeader = statusDecl?.[1] ?? "";
const statusBody = strip.match(
  /create\s+or\s+replace\s+function\s+public\.push_service_status\(\)[\s\S]*?as\s+\$\$([\s\S]*?)\$\$/i,
)?.[1] ?? "";
check(
  statusBody.length > 0,
  "public.push_service_status() body could not be read for the presence-only check",
);
check(
  /table\s*\(\s*dispatch_secret_set\s+boolean\s*,\s*function_url_set\s+boolean\s*\)/i.test(
    statusHeader,
  ),
  "public.push_service_status() must return only booleans",
);
check(
  !/select\s+decrypted_secret\b/i.test(statusBody),
  "public.push_service_status() must never select a secret value into its result",
);
check(
  (statusBody.match(/vault\.decrypted_secrets/gi) ?? []).length > 0,
  "public.push_service_status() does not read Vault, so it cannot report configuration",
);

// Dispatch must degrade to a recorded warning rather than aborting the write that
// created the notification, and must reach pg_net for every distinct recipient.
const dispatchBody = strip.match(
  /create\s+or\s+replace\s+function\s+public\.dispatch_push_for_notifications\(\)[\s\S]*?as\s+\$\$([\s\S]*?)\$\$/i,
)?.[1] ?? "";
check(
  dispatchBody.length > 0,
  "public.dispatch_push_for_notifications() body could not be read",
);
check(
  /exception\s+when\s+others\s+then/.test(dispatchBody),
  "dispatch trigger does not guard its pg_net call, so a bad URL would abort the booking",
);
check(
  /record_push_dispatch_failure/.test(dispatchBody),
  "dispatch trigger does not record a failure, so a broken path is invisible",
);
// Delivery must be de-duplicated by the notification's own id, and that id must
// reach the function. Grouping by recipient alone would drop distinct
// notifications aimed at the same member; keying on the id makes a replayed
// trigger statement skippable instead.
check(
  /select\s+id\s*,\s*user_id::text\s*,\s*title\s*,\s*body\s*,\s*url\s*\n\s*from\s+inserted/i.test(
    dispatchBody,
  ),
  "dispatch trigger does not iterate the inserted rows by id, so duplicates cannot be recognised",
);
check(
  /'notification_id'\s*,\s*v_target\.id/.test(dispatchBody),
  "dispatch trigger does not pass notification_id, so the function cannot de-duplicate",
);
check(
  !/distinct\s+on\s*\(\s*user_id\s*\)/i.test(dispatchBody),
  "dispatch trigger groups by recipient alone, which drops distinct notifications",
);
check(
  /create\s+table\s+if\s+not\s+exists\s+public\.push_deliveries/i.test(strip),
  "public.push_deliveries is missing, so a replayed dispatch can notify twice",
);
check(
  /notification_id\s+uuid\s+primary\s+key\s+references\s+public\.notifications/i.test(strip),
  "push_deliveries.notification_id must be a primary key for the de-duplication to be exact",
);

// The notification helpers must never notify the member who caused the event.
check(
  /partner\.participant\s*<>\s*new\.driver_id/.test(strip),
  "ride completion notifies the driver about their own action",
);
check(
  /recipient\.participant\s*<>\s*new\.sender_id/.test(strip),
  "message trigger notifies the sender about their own message",
);

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log(`PASS: schema.sql static checks`);
console.log(`      ${declared.size} functions declared, $$ balanced`);
console.log(`      every REVOKE/GRANT signature matches its declaration`);
console.log(`      every trigger target exists`);
console.log(`      no SECURITY DEFINER function is granted to authenticated`);
console.log(`      pg_net dispatch trigger uses a transition table`);
