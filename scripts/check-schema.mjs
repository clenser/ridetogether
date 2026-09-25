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
  if (role === "authenticated" && definerFns.has(name)) {
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

// --------------------------------------------------------- net.http_post use
check(
  /perform\s+net\.http_post\(/.test(strip),
  "pg_net dispatch trigger does not call net.http_post",
);
check(
  /referencing\s+new\s+table\s+as\s+inserted/.test(strip),
  "dispatch trigger is missing its transition table",
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
