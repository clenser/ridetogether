import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Persistent drafts for unfinished form input.
 *
 * A mobile OS may kill or recreate a PWA at any time, and a hard refresh throws
 * away every `useState` in a page. This module keeps the *in-progress* form
 * input in localStorage so the user gets their work back.
 *
 * What this is NOT: a cache. Rides, bookings, messages, notifications, users
 * and vehicles are always read from Supabase. Only unsaved form input is stored
 * here, and a draft is deleted the moment its workflow succeeds (or the user
 * discards it), so a stale draft can never masquerade as real data.
 *
 * Guarantees:
 *  - keyed by authenticated user id, so two people sharing a device never see
 *    each other's half-typed forms;
 *  - keyed by workflow, so offering a ride and finding one cannot collide;
 *  - written with a debounce so typing does not hammer localStorage;
 *  - restored synchronously in the `useState` initialiser, which means the very
 *    first render already holds the draft. Later effects that hydrate from the
 *    network therefore cannot overwrite it (see `hydrated` below);
 *  - secrets are stripped on write as defence in depth, so a token or password
 *    can never end up in localStorage even if a caller passes one by mistake.
 */

const STORAGE_PREFIX = "ridetogether:draft";
const DRAFT_VERSION = 1;
const WRITE_DEBOUNCE_MS = 400;

export type DraftScope =
  | "offer-ride"
  | "find-ride"
  | "profile"
  | "complete-profile"
  | "vehicle-form"
  | "safety-contact-form"
  | `chat:${string}`
  | `vehicle-form:${string}`
  | `safety-contact-form:${string}`;

interface DraftEnvelope<T> {
  v: number;
  scope: string;
  userId: string;
  savedAt: number;
  data: T;
}

/**
 * Keys that must never be written to disk, matched case-insensitively.
 *
 * `key` is matched on its own (not just `apikey`) so compound names such as
 * `supabaseServiceRoleKey` or `signingKey` are caught too. None of the form
 * fields this app drafts contain the substring "key".
 */
const SECRET_KEY = /(pass|pwd|secret|token|auth|jwt|key|credential|otp|pin|session|bearer|signature|private)/i;

/**
 * Recursively drops anything that looks like a credential. Coordinates and other
 * form values are plain JSON, so a deep copy is safe; `undefined` values are
 * dropped so they do not survive a JSON round trip as `null`.
 *
 * Exported so the guarantee is regression-testable: it is the last line of
 * defence that keeps tokens, passwords and Supabase keys out of localStorage.
 */
export const stripDraftSecrets = <T,>(value: T, depth = 0): T => {
  if (depth > 8) return value as T;
  if (Array.isArray(value)) return value.map((item) => stripDraftSecrets(item, depth + 1)) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    if (entry === undefined) continue;
    out[key] = stripDraftSecrets(entry, depth + 1);
  }
  return out as T;
};

const storageKey = (scope: DraftScope, userId: string): string =>
  `${STORAGE_PREFIX}:${scope}:${userId || "anonymous"}`;

const canUseStorage = (): boolean => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = `${STORAGE_PREFIX}:probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    // Safari private mode and storage-disabled browsers throw on write.
    return false;
  }
};

const isEnvelope = <T,>(raw: unknown, scope: DraftScope, userId: string): raw is DraftEnvelope<T> => {
  if (typeof raw !== "object" || raw === null) return false;
  const candidate = raw as Partial<DraftEnvelope<T>>;
  return candidate.v === DRAFT_VERSION
    && candidate.scope === scope
    && candidate.userId === userId
    && typeof candidate.savedAt === "number"
    && typeof candidate.data === "object"
    && candidate.data !== null;
};

export interface StoredDraft<T> {
  data: T;
  savedAt: number;
}

const readStored = <T,>(scope: DraftScope, userId: string): StoredDraft<T> | null => {
  if (!userId || !canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scope, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope<T>(parsed, scope, userId)) return null;
    return { data: parsed.data, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
};

const writeStored = <T,>(scope: DraftScope, userId: string, data: T): void => {
  if (!userId || !canUseStorage()) return;
  try {
    const envelope: DraftEnvelope<T> = {
      v: DRAFT_VERSION,
      scope,
      userId,
      savedAt: Date.now(),
      data: stripDraftSecrets(data),
    };
    window.localStorage.setItem(storageKey(scope, userId), JSON.stringify(envelope));
  } catch {
    // A full or unavailable quota must never break the form the user is filling in.
  }
};

export const clearDraft = (scope: DraftScope, userId: string): void => {
  if (!userId || !canUseStorage()) return;
  try {
    window.localStorage.removeItem(storageKey(scope, userId));
  } catch {
    // ignored on purpose, see writeStored
  }
};

/** True when this user has unfinished input saved for a workflow. */
export const hasDraft = (scope: DraftScope, userId: string): boolean =>
  readStored(scope, userId) !== null;

export interface UseDraftOptions<T> {
  /** Fields the app owns (a loaded profile, a selected vehicle) win on first load. */
  merge?: (draft: T, current: T) => T;
  /** Reject a draft that is too old to be useful. */
  maxAgeMs?: number;
  enabled?: boolean;
}

export interface DraftController<T> {
  value: T;
  setValue: React.Dispatch<React.SetStateAction<T>>;
  patch: (partial: Partial<T>) => void;
  /** True when a saved draft was adopted for this user+workflow. */
  restored: boolean;
  savedAt: number | null;
  /** Hide the resume banner without deleting the draft. */
  dismissBanner: () => void;
  /** Explicit user choice: throw the draft away and start clean. */
  discard: () => void;
  /** Workflow succeeded: the draft is no longer needed. */
  complete: () => void;
}

/**
 * Structural comparison for form values.
 *
 * Identity is not enough: effects routinely re-apply an identical value with a
 * fresh object (`(current) => ({ ...current, lastRoute: null })` on mount, for
 * example), and treating that as an edit would write a draft for a form nobody
 * has touched. Values here are plain JSON, so a bounded deep compare is cheap.
 */
const sameDraftValue = (a: unknown, b: unknown, depth = 0): boolean => {
  if (a === b) return true;
  if (depth > 8) return false;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    // Treat a missing key and an explicit `undefined` as the same thing.
    return (a === undefined && b === undefined) || Number.isNaN(a as number) && Number.isNaN(b as number);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => sameDraftValue(item, b[index], depth + 1));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameDraftValue(left[key], right[key], depth + 1)) return false;
  }
  return true;
};

/**
 * Draft-backed state.
 *
 * The draft is read inside the `useState` initialiser rather than in an effect,
 * so there is no window in which an empty value could be written back over a
 * saved draft while the profile or vehicle list is still loading.
 */
export function useDraft<T extends object>(
  scope: DraftScope,
  fallback: T,
  userId: string,
  options: UseDraftOptions<T> = {},
): DraftController<T> {
  const { merge, maxAgeMs, enabled = true } = options;

  // Captured once per user so a re-render never re-reads storage, and so the
  // initial value is stable for the lifetime of the mount.
  const [boot] = useState(() => {
    if (!enabled) return { initial: fallback, stored: null as StoredDraft<T> | null };
    const stored = readStored<T>(scope, userId);
    if (!stored) return { initial: fallback, stored: null };
    const fresh = maxAgeMs === undefined || Date.now() - stored.savedAt <= maxAgeMs;
    if (!fresh) {
      clearDraft(scope, userId);
      return { initial: fallback, stored: null };
    }
    const merged = merge ? merge(stored.data, fallback) : { ...fallback, ...stored.data };
    return { initial: merged, stored };
  });

  const [value, setValue] = useState<T>(boot.initial);
  const [restored, setRestored] = useState<boolean>(boot.stored !== null);
  const [savedAt, setSavedAt] = useState<number | null>(boot.stored?.savedAt ?? null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `boot` is per-mount, but a user switch must not carry one user's form into
  // another's session, so the effect below re-seeds when the user changes.
  const userRef = useRef(userId);
  const scopeRef = useRef(scope);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  /**
   * Whether there is unfinished input worth writing to disk. Starts false so an
   * untouched form does not create a draft the user never asked for, and is
   * cleared by `discard` so a discarded form cannot be written back.
   */
  const dirtyRef = useRef(boot.stored !== null);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Distinguishes the first render (already handled by the state initialiser)
  // from a later scope/user change, which must re-read storage.
  const bootKey = useRef(`${scope}::${userId}::${enabled}`);

  useEffect(() => {
    const key = `${scope}::${userId}::${enabled}`;
    if (bootKey.current === key) return;
    bootKey.current = key;

    // A debounce armed for the previous scope is about to write the old form
    // into the new key. Cancel it before re-seeding.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    userRef.current = userId;
    scopeRef.current = scope;

    if (!enabled) {
      setRestored(false);
      setSavedAt(null);
      return;
    }
    const stored = readStored<T>(scope, userId);
    // No draft for this user+workflow: fall back to a clean form. Without this
    // the previous user's (or previous vehicle's) input would stay on screen.
    dirtyRef.current = stored !== null;
    if (!stored) {
      setValue(fallback);
      setRestored(false);
      setSavedAt(null);
      return;
    }
    const merged = merge ? merge(stored.data, fallback) : { ...fallback, ...stored.data };
    setValue(merged);
    setRestored(true);
    setSavedAt(stored.savedAt);
    // `fallback`/`merge` are literals from the component body; re-seeding on
    // their identity would discard the user's input on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userId, enabled]);

  const flush = useCallback(() => {
    if (!enabledRef.current || !dirtyRef.current) return;
    writeStored(scopeRef.current, userRef.current, value);
    setSavedAt(Date.now());
  }, [value]);

  /**
   * `setValue` that also records that the form now holds real input. Eagerly
   * evaluating the updater keeps the dirty check honest, and a re-applied
   * identical value does not count as an edit, so a pristine form never creates
   * a draft.
   */
  const updateValue = useCallback<React.Dispatch<React.SetStateAction<T>>>((action) => {
    const current = valueRef.current;
    const next = typeof action === "function" ? action(current) : action;
    if (!sameDraftValue(next, current)) dirtyRef.current = true;
    // Keep the mirror in step so two updates in the same tick compose instead of
    // the second overwriting the first.
    valueRef.current = next;
    setValue(next);
  }, []);

  // Debounced autosave.
  useEffect(() => {
    if (!enabledRef.current || !dirtyRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      writeStored(scopeRef.current, userRef.current, value);
      setSavedAt(Date.now());
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value]);

  // A pending debounce is lost if the tab is backgrounded in that window, so
  // flush synchronously when the page is hidden or unloaded. `visibilitychange`
  // is fired on `document`, so listen there rather than relying on bubbling.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  const patch = useCallback((partial: Partial<T>) => {
    updateValue((current) => ({ ...current, ...partial }));
  }, [updateValue]);

  const dismissBanner = useCallback(() => setRestored(false), []);

  const reset = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    clearDraft(scope, userId);
    // A discarded form is clean, so the autosave effect must not immediately
    // write the empty values straight back to storage.
    dirtyRef.current = false;
    setValue(fallback);
    setRestored(false);
    setSavedAt(null);
    // `fallback` is a literal defined in the component body; re-running on every
    // render would reset the form, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userId]);

  const complete = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    clearDraft(scope, userId);
    // Keep the current values on screen, but stop autosaving them.
    dirtyRef.current = false;
    setRestored(false);
  }, [scope, userId]);

  return useMemo(
    () => ({ value, setValue: updateValue, patch, restored, savedAt, dismissBanner, discard: reset, complete }),
    [value, updateValue, patch, restored, savedAt, dismissBanner, reset, complete],
  );
}

/** Formats a draft timestamp for the resume banner. */
export const formatDraftAge = (savedAt: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
};
