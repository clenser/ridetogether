import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "live";

interface BadgeProps {
  tone?: BadgeTone;
  /** Adds a leading dot. Use with `live` for a pulsing in-progress indicator. */
  dot?: boolean;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "",
  brand: "ds-badge--brand",
  success: "ds-badge--success",
  warning: "ds-badge--warning",
  danger: "ds-badge--danger",
  info: "ds-badge--info",
  live: "ds-badge--live",
};

export function Badge({ tone = "neutral", dot = false, icon: Icon, children, className = "" }: BadgeProps) {
  return (
    <span className={["ds-badge", TONE_CLASS[tone], className].filter(Boolean).join(" ")}>
      {dot ? <span className="ds-badge__dot" aria-hidden="true" /> : null}
      {Icon ? <Icon size={13} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon-only control is meaningless without a name. */
  label: string;
  icon: LucideIcon;
  size?: number;
  /** Draws the resting surface and border, for controls on a plain background. */
  bordered?: boolean;
  tone?: "default" | "danger";
  /** Unread count. Rendered as a bubble and appended to the label. */
  badge?: number;
}

export function IconButton({
  label,
  icon: Icon,
  size = 20,
  bordered = false,
  tone = "default",
  badge = 0,
  className = "",
  ...rest
}: IconButtonProps) {
  const badgeText = badge > 99 ? "99+" : String(badge);
  const accessibleLabel = badge > 0 ? `${label}, ${badgeText} unread` : label;

  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      className={[
        "ds-icon-button",
        bordered ? "ds-icon-button--bordered" : "",
        tone === "danger" ? "ds-icon-button--danger" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={accessibleLabel}
    >
      <Icon size={size} aria-hidden="true" />
      {badge > 0 ? (
        <span className="ds-icon-button__badge" aria-hidden="true">
          {badgeText}
        </span>
      ) : null}
    </button>
  );
}

export default IconButton;
