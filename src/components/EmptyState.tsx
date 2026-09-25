import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon: Icon = Inbox, action, children, className = "" }: EmptyStateProps) {
  return (
    <section className={`empty-state${className ? ` ${className}` : ""}`}>
      <span className="empty-state__icon" aria-hidden="true">
        <Icon size={28} />
      </span>
      <h2>{title}</h2>
      {description ? <div className="empty-state__description">{description}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
      {children ? <div className="empty-state__content">{children}</div> : null}
    </section>
  );
}

export default EmptyState;
