import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Star } from "lucide-react";

export interface StarsProps {
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  size?: "small" | "medium" | "large";
  label?: string;
  className?: string;
}

const starValues = [1, 2, 3, 4, 5] as const;

export function Stars({ value, onChange, readOnly = false, size = "medium", label = "Rating", className = "" }: StarsProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);
  const normalizedValue = Math.min(5, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
  const displayedValue = hoveredValue ?? normalizedValue;
  const isInteractive = !readOnly && typeof onChange === "function";
  const rootClassName = ["stars", `stars--${size}`, className].filter(Boolean).join(" ");

  if (!isInteractive) {
    return (
      <span className={rootClassName} role="img" aria-label={`${label}: ${normalizedValue} out of 5 stars`}>
        {starValues.map((starValue) => (
          <Star
            key={starValue}
            className={`stars__star${starValue <= normalizedValue ? " is-filled" : ""}`}
            size={size === "small" ? 15 : size === "large" ? 24 : 19}
            fill={starValue <= normalizedValue ? "currentColor" : "none"}
            aria-hidden="true"
          />
        ))}
      </span>
    );
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") nextIndex = Math.min(4, index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = 4;
    else return;

    event.preventDefault();
    onChange?.(nextIndex + 1);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <span className={rootClassName} role="radiogroup" aria-label={label} onMouseLeave={() => setHoveredValue(null)}>
      {starValues.map((starValue, index) => (
        <button
          key={starValue}
          ref={(element) => {
            buttonRefs.current[index] = element;
          }}
          className="stars__button"
          type="button"
          role="radio"
          aria-checked={normalizedValue === starValue}
          tabIndex={normalizedValue === starValue || (normalizedValue === 0 && index === 0) ? 0 : -1}
          aria-label={`${starValue} ${starValue === 1 ? "star" : "stars"}`}
          onMouseEnter={() => setHoveredValue(starValue)}
          onFocus={() => setHoveredValue(starValue)}
          onBlur={() => setHoveredValue(null)}
          onClick={() => onChange?.(starValue)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          <Star
            className="stars__star"
            size={size === "small" ? 15 : size === "large" ? 24 : 19}
            fill={starValue <= displayedValue ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
      ))}
    </span>
  );
}

export default Stars;
