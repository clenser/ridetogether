import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, subtitle, eyebrow, actions, children, className = "" }: PageHeaderProps) {
  const supportingText = description ?? subtitle;
  return (
    <header className={`page-header${className ? ` ${className}` : ""}`}>
      <div className="page-header__copy">
        {eyebrow ? <div className="page-header__eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {supportingText ? <div className="page-header__description">{supportingText}</div> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
      {children ? <div className="page-header__content">{children}</div> : null}
    </header>
  );
}

export default PageHeader;
