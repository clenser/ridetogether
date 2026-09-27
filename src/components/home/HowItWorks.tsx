import type { LucideIcon } from "lucide-react";

export interface HowItWorksStep {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

interface HowItWorksProps {
  steps: HowItWorksStep[];
  className?: string;
}

/**
 * The numbered explanation of a journey.
 *
 * An ordered list, because the order is the point: a rider needs to know what
 * happens first before the later steps make sense. The counter is decorative
 * here, so it is hidden from assistive tech and the real position comes from
 * the list semantics.
 */
export function HowItWorks({ steps, className = "" }: HowItWorksProps) {
  return (
    <ol className={["ds-how", className].filter(Boolean).join(" ")}>
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <li className="ds-how__step" key={step.id}>
            <span className="ds-how__marker" aria-hidden="true">
              <Icon size={19} />
            </span>
            <span className="ds-how__body">
              <span className="ds-how__count" aria-hidden="true">
                Step {index + 1}
              </span>
              <span className="ds-how__title">{step.title}</span>
              <span className="ds-how__description">{step.description}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default HowItWorks;
