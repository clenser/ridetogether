import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Badge";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hide the header entirely for a content-only sheet. */
  hideTitle?: boolean;
  description?: string;
  children: ReactNode;
  /** Sticky action row at the bottom of the sheet. */
  footer?: ReactNode;
  /** Tapping the backdrop closes the sheet. Off for destructive confirmations. */
  dismissOnBackdrop?: boolean;
  testId?: string;
}

/**
 * One component for both presentations: a bottom sheet on a narrow viewport and
 * a centred dialog on a wide one. The CSS decides which; this component only
 * guarantees the behaviour, which is the part that is easy to get wrong twice.
 *
 * Behaviour provided:
 *   - Escape closes.
 *   - Focus moves into the sheet on open and returns to the trigger on close.
 *   - Tab is trapped inside while open, so the keyboard cannot wander into the
 *     page behind the overlay.
 *   - The page behind is marked `inert`-like via `aria-modal` and scroll lock.
 */
export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  children,
  footer,
  dismissOnBackdrop = true,
  testId,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    /* Lock the page behind the sheet. `overscroll-behavior` alone is not enough
       on iOS, where the whole document scrolls unless this is set. */
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    /* Move focus in without stealing it from the close button, so a keyboard
       user can dismiss immediately with Escape or Tab. */
    const focusTimer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        "[data-autofocus], input:not([type='hidden']), button, [tabindex]:not([tabindex='-1'])",
      );
      (target ?? panelRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ds-sheet-backdrop"
      data-testid={testId}
      onMouseDown={(event) => {
        /* Only a press that both starts and ends on the backdrop dismisses.
           Dragging a text selection out of the sheet would otherwise close it. */
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="ds-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideTitle ? undefined : titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <span className="ds-sheet__handle" aria-hidden="true" />
        {hideTitle ? null : (
          <header className="ds-sheet__header">
            <div>
              <h2 className="ds-sheet__title" id={titleId}>
                {title}
              </h2>
              {description ? (
                <p className="ds-hint" id={descriptionId} style={{ margin: "4px 0 0" }}>
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </header>
        )}
        <div className="ds-sheet__body">{children}</div>
        {footer ? <footer className="ds-sheet__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export default Sheet;
