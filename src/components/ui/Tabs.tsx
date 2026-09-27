import type { KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";

export interface TabItem {
  id: string;
  label: string;
  /** Rendered next to the label. Used for the per-tab result counts. */
  count?: number;
}

/**
 * A real tablist.
 *
 * Arrow keys move focus and selection, Home/End jump to the ends, and only the
 * selected tab is in the tab order. This is the difference between a row of
 * buttons that looks like tabs and a tablist a screen reader can navigate.
 */
interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** `underline` for a page with its own header above the tabs. */
  variant?: "segmented" | "underline";
  /** Accessible name for the tablist. */
  label: string;
  className?: string;
  idPrefix?: string;
}

export function Tabs({
  items,
  activeId,
  onChange,
  variant = "segmented",
  label,
  className = "",
  idPrefix = "tab",
}: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    const next = items[clamped];
    if (!next) return;
    onChange(next.id);
    /* The roving focus has to move with selection, or the keyboard user is left
       focused on a tab that is no longer selected. */
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${idPrefix}-${next.id}`)}`)
      ?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(items.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={listRef}
      className={["ds-tabs", variant === "underline" ? "ds-tabs--underline" : "", className]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
      aria-label={label}
    >
      {items.map((item, index) => {
        const selected = item.id === activeId;
        return (
          <button
            key={item.id}
            id={`${idPrefix}-${item.id}`}
            className="ds-tab"
            type="button"
            role="tab"
            aria-selected={selected}
            /* Roving tabindex: one stop for the whole group. */
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" ? (
              <span className="ds-tab__count" aria-hidden="true">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Each option stretches to fill the row. */
  block?: boolean;
  label: string;
  className?: string;
}

/**
 * A small set of mutually exclusive options that change what is displayed.
 * `aria-pressed` rather than a tablist, because these are toggles, not panels.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  block = false,
  label,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      className={["ds-segment", block ? "ds-segment--block" : "", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          className="ds-segment__option"
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export default Tabs;
