import type { InputHTMLAttributes } from "react";
import { useId } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  /** Announced in place of the placeholder when there is no placeholder. */
  label?: string;
  onClear?: () => void;
  containerClassName?: string;
}

/**
 * The header's global search field.
 *
 * `type="search"` so a mobile keyboard offers its search/enter key rather than
 * a return that submits nothing. The clear affordance is a real button so it is
 * reachable by keyboard, and it is only rendered when there is something to
 * clear.
 */
export function SearchInput({
  label = "Search",
  onClear,
  containerClassName = "",
  value,
  id,
  ...inputProps
}: SearchInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasValue = typeof value === "string" && value.length > 0;

  return (
    <div className={["ds-search", containerClassName].filter(Boolean).join(" ")} role="search">
      <Search size={17} aria-hidden="true" />
      <input
        {...inputProps}
        id={inputId}
        type="search"
        className="ds-input"
        value={value}
        aria-label={inputProps["aria-label"] ?? label}
        onKeyDown={(event) => {
          inputProps.onKeyDown?.(event);
          /* Escape clears, which is what a search field is expected to do and
             saves the user reaching for the clear button. */
          if (event.key === "Escape" && hasValue) onClear?.();
        }}
      />
      {hasValue && onClear ? (
        <button className="ds-search__clear" type="button" aria-label="Clear search" onClick={onClear}>
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export default SearchInput;
