import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  value: ReactNode;
  label: string;
  tone?: "brand" | "success" | "warning" | "danger" | "info" | "neutral";
  className?: string;
}

const TONE_BACKGROUND: Record<NonNullable<StatCardProps["tone"]>, string> = {
  brand: "var(--rt-primary-soft)",
  success: "var(--rt-success-soft)",
  warning: "var(--rt-warning-soft)",
  danger: "var(--rt-danger-soft)",
  info: "var(--rt-info-soft)",
  neutral: "var(--rt-surface-muted)",
};

const TONE_COLOR: Record<NonNullable<StatCardProps["tone"]>, string> = {
  brand: "var(--rt-primary-deep)",
  success: "var(--rt-success-text)",
  warning: "var(--rt-warning-text)",
  danger: "var(--rt-danger-text)",
  info: "var(--rt-info-text)",
  neutral: "var(--rt-muted)",
};

export function StatCard({ icon: Icon, value, label, tone = "brand", className = "" }: StatCardProps) {
  return (
    <div className={["ds-stat", className].filter(Boolean).join(" ")}>
      <span
        className="ds-stat__icon"
        style={{ background: TONE_BACKGROUND[tone], color: TONE_COLOR[tone] }}
        aria-hidden="true"
      >
        <Icon size={19} />
      </span>
      <span className="ds-stat__body">
        <strong className="ds-stat__value">{value}</strong>
        <span className="ds-stat__label">{label}</span>
      </span>
    </div>
  );
}

export type StepState = "done" | "active" | "upcoming";

export interface Step {
  id: string;
  title: string;
  description?: string;
}

interface StepIndicatorProps {
  steps: Step[];
  /** Index of the step the member is on. */
  activeIndex: number;
  /** `horizontal` is a desktop rail; `vertical` is the mobile stepper. */
  orientation?: "vertical" | "horizontal";
  className?: string;
}

/**
 * Progress through a multi-step form.
 *
 * The markers are ordered lists rather than divs, because "step 2 of 5" is
 * information the list semantics carry for free.
 */
export function StepIndicator({
  steps,
  activeIndex,
  orientation = "vertical",
  className = "",
}: StepIndicatorProps) {
  return (
    <ol
      className={[
        "ds-steps",
        orientation === "horizontal" ? "ds-steps--horizontal" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {steps.map((step, index) => {
        const state: StepState = index < activeIndex ? "done" : index === activeIndex ? "active" : "upcoming";
        return (
          <li
            key={step.id}
            className={`ds-step ds-step--${state}`}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="ds-step__marker" aria-hidden="true">
              {state === "done" ? <Check size={16} /> : index + 1}
            </span>
            <span className="ds-step__text">
              <span className="ds-step__title">{step.title}</span>
              {step.description ? (
                <span className="ds-step__description">{step.description}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type TimelineState = "done" | "active" | "upcoming";

export interface TimelineItem {
  id: string;
  title: string;
  meta?: string;
  state?: TimelineState;
  icon?: LucideIcon;
}

interface TimelineProps {
  items: TimelineItem[];
  className?: string;
  /** Announced in place of the visible list. */
  label?: string;
}

export function Timeline({ items, className = "", label = "Trip progress" }: TimelineProps) {
  return (
    <ol className={["ds-timeline", className].filter(Boolean).join(" ")} aria-label={label}>
      {items.map((item) => {
        const state = item.state ?? "upcoming";
        const Icon = item.icon;
        return (
          <li key={item.id} className={`ds-timeline__item ds-timeline__item--${state}`}>
            <span className="ds-timeline__marker" aria-hidden="true">
              {state === "done" ? <Check size={13} /> : Icon ? <Icon size={13} /> : null}
            </span>
            <span className="ds-timeline__content">
              <span className="ds-timeline__title">{item.title}</span>
              {item.meta ? <span className="ds-timeline__meta">{item.meta}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default StatCard;
