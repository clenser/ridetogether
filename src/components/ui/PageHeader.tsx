import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Small uppercase line above the title. */
  eyebrow?: string;
  description?: ReactNode;
  /** Buttons or a control cluster, right-aligned on desktop. */
  actions?: ReactNode;
  className?: string;
  /** Rendered above everything, for breadcrumbs or a back link. */
  above?: ReactNode;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className = "",
  above,
}: PageHeaderProps) {
  return (
    <header className={["ds-page-header", className].filter(Boolean).join(" ")}>
      {above}
      <div>
        {eyebrow ? <span className="ds-page-header__eyebrow">{eyebrow}</span> : null}
        <h1 className="ds-page-header__title">{title}</h1>
        {description ? <p className="ds-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="ds-page-header__actions">{actions}</div> : null}
    </header>
  );
}

interface SectionHeaderProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Heading level, so a page keeps one `h1` and a sane outline below it. */
  as?: "h2" | "h3";
  id?: string;
}

export function SectionHeader({
  title,
  description,
  action,
  className = "",
  as: Heading = "h2",
  id,
}: SectionHeaderProps) {
  return (
    <div className={["ds-section-header", className].filter(Boolean).join(" ")}>
      <div>
        <Heading className="ds-section-header__title" id={id}>
          {title}
        </Heading>
        {description ? <p className="ds-section-header__description">{description}</p> : null}
      </div>
      {action ? <div className="ds-section-header__action">{action}</div> : null}
    </div>
  );
}

interface TrustItem {
  icon: ReactNode;
  title: string;
  body: string;
}

/**
 * The reassurance strip. Three compact cards in one row on desktop, a
 * horizontal scroller on mobile - deliberately small, because its job is to
 * answer "is this safe?" in one glance, not to fill the page.
 */
export function TrustStrip({ items, className = "" }: { items: TrustItem[]; className?: string }) {
  return (
    <ul className={["ds-trust", className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <li key={item.title} className="ds-trust__item">
          <span className="ds-trust__icon" aria-hidden="true">
            {item.icon}
          </span>
          <span>
            <span className="ds-trust__title">{item.title}</span>
            <span className="ds-trust__body">{item.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default PageHeader;
