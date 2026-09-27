import { useCallback, useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { normalizeUpiId } from "../services/payment";

export interface UpiMessage {
  type: "success" | "error";
  text: string;
}

/**
 * Turns a repository error into something worth showing a member.
 *
 * Supabase returns policy, relation and column errors verbatim, which tell a
 * developer everything and a member nothing, so those are swapped for a plain
 * sentence while a real validation message from `normalizeUpiId` passes through.
 */
const describeUpiError = (error: unknown, action: "load" | "save" | "clear"): string => {
  if (error instanceof Error && error.message && !/select|insert|update|policy|relation|column/i.test(error.message)) {
    return error.message;
  }
  return action === "load"
    ? "We could not load your saved UPI ID. You can still save a new one."
    : action === "save"
      ? "We could not save your UPI ID. Check your connection and try again."
      : "We could not remove your UPI ID. Check your connection and try again.";
};

/**
 * The member's own UPI handle, as an editable field.
 *
 * A UPI handle lives in an owner-only table that is deliberately kept out of the
 * app snapshot, so it is loaded on demand and owned by whichever screen is
 * showing it. Profile and Settings both edit it, so the load/save/clear cycle
 * lives here once rather than being reimplemented - two copies of this state
 * machine would drift, and one of them would eventually stop clearing the
 * stored handle properly.
 *
 * Nothing here blocks a profile from being completed: `saving` is independent of
 * any profile form, and clearing the draft is always allowed.
 */
export function useUpiId() {
  const { activeUserId, readMyUpiId, saveUpiId, clearUpiId } = useApp();

  const [draft, setDraft] = useState("");
  const [stored, setStored] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<UpiMessage | null>(null);

  useEffect(() => {
    if (!activeUserId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const saved = await readMyUpiId();
        if (cancelled) return;
        setStored(saved);
        setDraft(saved ?? "");
      } catch (error) {
        if (cancelled) return;
        // A handle that cannot be read is not a reason to block the page; the
        // member can still type a new one.
        setMessage({ type: "error", text: describeUpiError(error, "load") });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeUserId, readMyUpiId]);

  const save = useCallback(async () => {
    if (saving) return;
    const { upiId, error } = normalizeUpiId(draft);
    if (error) {
      setMessage({ type: "error", text: error });
      return;
    }
    if (!upiId) {
      setMessage({ type: "error", text: "Enter a UPI ID, or use Clear to remove the saved one." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveUpiId(upiId);
      setDraft(upiId);
      setStored(upiId);
      setMessage({ type: "success", text: "UPI ID saved to your private payment profile." });
    } catch (caught) {
      setMessage({ type: "error", text: describeUpiError(caught, "save") });
    } finally {
      setSaving(false);
    }
  }, [draft, saveUpiId, saving]);

  const clear = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await clearUpiId();
      setDraft("");
      setStored(undefined);
      setMessage({ type: "success", text: "UPI ID removed." });
    } catch (caught) {
      setMessage({ type: "error", text: describeUpiError(caught, "clear") });
    } finally {
      setSaving(false);
    }
  }, [clearUpiId, saving]);

  return { draft, setDraft, stored, loading, saving, message, save, clear };
}
