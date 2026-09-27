import { CreditCard, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { Skeleton } from "./State";
import { useUpiId } from "../../hooks/useUpiId";

/**
 * The member's optional UPI handle.
 *
 * Optional by design: this is a settlement detail for when real payouts arrive,
 * never a condition for a usable profile. So it loads on its own, reports a
 * failure without blocking the page around it, and is never validated as part
 * of any other form.
 */
export function UpiField({ className = "" }: { className?: string }) {
  const { draft, setDraft, stored, loading, saving, message, save, clear } = useUpiId();
  const invalid = message?.type === "error" && /enter a upi|not accepted|invalid/i.test(message.text);

  return (
    <div className={["ds-upi", className].filter(Boolean).join(" ")}>
      <div className="ds-upi__head">
        <span className="ds-upi__icon" aria-hidden="true">
          <CreditCard size={18} />
        </span>
        <span className="ds-upi__copy">
          <span className="ds-upi__title">UPI ID</span>
          <span className="ds-upi__description">
            Optional. Used for settlement once real payouts are enabled - nothing is transferred today.
          </span>
        </span>
        {stored ? (
          <span className="ds-upi__badge">Saved</span>
        ) : (
          <span className="ds-upi__badge ds-upi__badge--empty">Not set</span>
        )}
      </div>

      {loading ? (
        <div className="ds-upi__row">
          <Skeleton height={42} width="100%" variant="block" />
        </div>
      ) : (
        <div className="ds-upi__row">
          <input
            className="ds-upi__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="yourname@bank"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-label="UPI ID"
            aria-invalid={invalid}
            aria-describedby="ds-upi-hint"
            data-testid="upi-input"
          />
          <Button
            variant="secondary"
            onClick={() => void save()}
            loading={saving}
            loadingLabel="Saving"
            data-testid="upi-save"
          >
            Save
          </Button>
          {stored ? (
            <Button
              variant="ghost"
              onClick={() => void clear()}
              disabled={saving}
              aria-label="Remove saved UPI ID"
              data-testid="upi-clear"
            >
              <Trash2 size={16} aria-hidden="true" />
              <span className="ds-upi__clear-label">Remove</span>
            </Button>
          ) : null}
        </div>
      )}

      <p className="ds-upi__hint" id="ds-upi-hint">
        <ShieldCheck size={13} aria-hidden="true" />
        <span>Stored in a private table only you can read. It is never shown to drivers or riders.</span>
      </p>

      {message ? (
        <p
          className={`ds-upi__message${message.type === "error" ? " ds-upi__message--error" : ""}`}
          role="status"
          data-testid={message.type === "error" ? "upi-error" : "upi-success"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export default UpiField;
