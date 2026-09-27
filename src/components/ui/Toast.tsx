import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** How long a toast stays up. Errors linger because they usually need reading. */
const DISMISS_AFTER: Record<ToastTone, number> = {
  success: 4000,
  info: 4500,
  warning: 6500,
  error: 8000,
};

const TONE_ICON: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

/**
 * Transient confirmations for actions that complete without a navigation -
 * a saved profile, a recorded payout, a copied link.
 *
 * Deliberately small: anything the member needs to keep (a booking reference, an
 * error) belongs on the page, not in a message that disappears.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  /* Timers are held in a ref so a dismiss triggered by the close button cancels
     the pending auto-dismiss instead of firing a second state update. */
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current.slice(-2), { id, tone, message }]);
    const timer = window.setTimeout(() => dismiss(id), DISMISS_AFTER[tone]);
    timers.current.set(id, timer);
  }, [dismiss]);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/*
        `aria-live="polite"` so a confirmation is announced without interrupting
        whatever the member is doing. Errors are individually `role="alert"`,
        which does interrupt, because they are the ones that must not be missed.
      */}
      <div className="ds-toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone];
          return (
            <div
              key={toast.id}
              className={`ds-toast ds-toast--${toast.tone}`}
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <Icon className="ds-toast__icon" size={18} aria-hidden="true" />
              <span className="ds-toast__text">{toast.message}</span>
              <button
                className="ds-toast__close"
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(toast.id)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Returns a no-op outside a provider so a component can be rendered in
 * isolation (a test, a storybook-style harness) without a crash.
 */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  return (
    context ?? {
      show: () => undefined,
      dismiss: () => undefined,
    }
  );
}

export default ToastProvider;
