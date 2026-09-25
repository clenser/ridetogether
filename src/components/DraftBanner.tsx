import { RotateCcw, X } from "lucide-react";

export interface DraftBannerProps {
  savedAt: number | null;
  /** e.g. "offer ride" - shown as "your unfinished offer ride". */
  workflow: string;
  onDiscard: () => void;
  onDismiss?: () => void;
}

/**
 * Shown when a workflow was restored from a saved draft, so the user knows their
 * input came back and can throw it away in one click instead of silently
 * continuing with it.
 */
export function DraftBanner({ savedAt, workflow, onDiscard, onDismiss }: DraftBannerProps) {
  const age = savedAt ? formatAge(savedAt) : null;
  return (
    <div className="draft-banner" role="status">
      <div className="draft-banner-text">
        <strong>Saved {age ? `${age}` : "recently"}</strong>
        <span>We kept your unfinished {workflow}.</span>
      </div>
      <div className="draft-banner-actions">
        <button className="btn btn-ghost btn-sm" type="button" onClick={onDiscard}>
          <RotateCcw size={15} /> Discard
        </button>
        {onDismiss ? (
          <button
            className="draft-banner-close"
            type="button"
            onClick={onDismiss}
            aria-label="Hide this message"
          >
            <X size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

const formatAge = (savedAt: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
};
