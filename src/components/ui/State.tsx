import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { Button } from "./Button";

interface StateProps {
  /** `empty` for nothing-yet, `error` for something-went-wrong. */
  tone?: "empty" | "error";
  title: string;
  body?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionLoading?: boolean;
  icon?: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * The single empty/error state. Both tones share a shape - icon, title,
 * explanation, one action - because the difference is only the icon and the
 * colour, and having one component is what stops them drifting apart.
 */
export function State({
  tone = "empty",
  title,
  body,
  actionLabel,
  onAction,
  actionLoading = false,
  icon,
  className = "",
  testId,
}: StateProps) {
  const fallbackIcon = tone === "error" ? <AlertTriangle size={24} /> : <Inbox size={24} />;

  return (
    <div
      className={["ds-state", tone === "error" ? "ds-state--error" : "", className].filter(Boolean).join(" ")}
      data-testid={testId}
      /* An empty result is not an error, and a failed load is announced as soon
         as it appears rather than only when the user finds it. */
      role={tone === "error" ? "alert" : undefined}
    >
      <span className="ds-state__icon" aria-hidden="true">
        {icon ?? fallbackIcon}
      </span>
      <p className="ds-state__title">{title}</p>
      {body ? <p className="ds-state__body">{body}</p> : null}
      {actionLabel && onAction ? (
        <div className="ds-state__action">
          <Button
            variant={tone === "error" ? "primary" : "secondary"}
            onClick={onAction}
            loading={actionLoading}
            loadingLabel="Retrying"
          >
            {tone === "error" ? <RefreshCw size={16} aria-hidden="true" /> : null}
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: "text" | "title" | "circle" | "block";
  className?: string;
}

export function Skeleton({ width, height, variant = "text", className = "" }: SkeletonProps) {
  return (
    <span
      className={[
        "ds-skeleton",
        variant === "text" ? "ds-skeleton--text" : "",
        variant === "title" ? "ds-skeleton--title" : "",
        variant === "circle" ? "ds-skeleton--circle" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width, height, display: variant === "block" ? "block" : undefined }}
      aria-hidden="true"
    />
  );
}

interface SkeletonCardProps {
  /** How many text lines to stand in for. */
  lines?: number;
  className?: string;
}

export function SkeletonCard({ lines = 3, className = "" }: SkeletonCardProps) {
  return (
    <div className={["ds-skeleton-card", "ds-skeleton-stack", className].filter(Boolean).join(" ")}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Skeleton variant="circle" width={44} height={44} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton variant="title" />
          <Skeleton width="35%" />
        </div>
      </div>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? "62%" : "100%"} />
      ))}
    </div>
  );
}

/**
 * A list of skeletons sized like the real cards. Used where a first load has
 * nothing to show yet, so the page arrives in its final shape instead of
 * jumping once the data lands.
 */
export function SkeletonList({ count = 3, className = "" }: { count?: number; className?: string }) {
  return (
    <div
      className={["ds-skeleton-stack", className].filter(Boolean).join(" ")}
      /* Announced once as a group rather than as N separate placeholders. */
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

export default State;
