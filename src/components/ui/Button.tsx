import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "subtle"
  | "ghost"
  | "danger"
  | "danger-quiet"
  /** For a lone action on a brand-coloured surface, e.g. a closing CTA. */
  | "inverse";

export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Replaces the label with a spinner and blocks interaction. */
  loading?: boolean;
  /** Announced instead of the visible label while loading. */
  loadingLabel?: string;
  block?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "ds-button--primary",
  secondary: "ds-button--secondary",
  subtle: "ds-button--subtle",
  ghost: "ds-button--ghost",
  danger: "ds-button--danger",
  "danger-quiet": "ds-button--danger-quiet",
  inverse: "ds-button--inverse",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "ds-button--sm",
  md: "",
  lg: "ds-button--lg",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel,
  block = false,
  className = "",
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "ds-button",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    block ? "ds-button--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      /* A loading button is disabled for real, not just visually, so it cannot
         be activated twice by a double tap or an Enter key repeat. */
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <>
          <LoaderCircle className="ds-button__spinner" size={17} aria-hidden="true" />
          <span className="ds-visually-hidden">{loadingLabel ?? "Working"}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export default Button;
