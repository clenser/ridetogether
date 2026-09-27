import type { ReactNode } from "react";

interface GroupProps {
  title: string;
  description?: ReactNode;
  /** A control for the whole group, e.g. "Add contact". */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * A titled block of related rows.
 *
 * The card and its heading are one component because they are always used
 * together: a bare card with a floating caption is what produced the earlier
 * pages where every panel looked the same and nothing said what it was for.
 */
export function Group({ title, description, action, children, className = "", id }: GroupProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={["ds-group", className].filter(Boolean).join(" ")} aria-labelledby={headingId}>
      <div className="ds-group__head">
        <div className="ds-group__headline">
          <h2 className="ds-group__title" id={headingId}>
            {title}
          </h2>
          {description ? <p className="ds-group__description">{description}</p> : null}
        </div>
        {action ? <div className="ds-group__action">{action}</div> : null}
      </div>
      <div className="ds-group__body">{children}</div>
    </section>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** The control on the trailing edge - a switch, a button, a value. */
  action?: ReactNode;
  /** Rendered under the description, e.g. a field or a list of links. */
  children?: ReactNode;
  tone?: "default" | "danger";
  className?: string;
  as?: "div" | "label";
  htmlFor?: string;
}

/**
 * One line inside a group: what it is, what it does, and the control.
 *
 * When there is a control and nothing below, the row is a `<label>` so clicking
 * the text toggles the switch or focuses the input. That is the difference
 * between a settings page that feels native and one that makes people aim at
 * small targets.
 */
export function Row({
  icon,
  title,
  description,
  action,
  children,
  tone = "default",
  className = "",
  as,
  htmlFor,
}: RowProps) {
  const interactive = Boolean(action) || Boolean(htmlFor);
  const Tag = as ?? (interactive ? "label" : "div");

  return (
    <Tag
      className={["ds-row", tone === "danger" ? "ds-row--danger" : "", className].filter(Boolean).join(" ")}
      {...(htmlFor ? { htmlFor } : {})}
    >
      {icon ? <span className="ds-row__icon">{icon}</span> : null}
      <span className="ds-row__copy">
        <span className="ds-row__title">{title}</span>
        {description ? <span className="ds-row__description">{description}</span> : null}
        {children}
      </span>
      {action ? <span className="ds-row__action">{action}</span> : null}
    </Tag>
  );
}

/** A short read-only value shown on the trailing edge of a row. */
export function RowValue({
  children,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "brand";
  className?: string;
}) {
  return (
    <span
      className={["ds-row__value", tone === "default" ? "" : `ds-row__value--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

/** A compact stat for a page header or an overview panel. */
export function Metric({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  tone?: "default" | "brand" | "accent";
}) {
  return (
    <div className={["ds-metric", tone === "default" ? "" : `ds-metric--${tone}`].filter(Boolean).join(" ")}>
      {icon ? (
        <span className="ds-metric__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="ds-metric__value">{value}</span>
      <span className="ds-metric__label">{label}</span>
    </div>
  );
}

export default Group;
