import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { searchLocations } from "../services/geocoding";
import type { Coordinates } from "../types";

export interface LocationSearchProps {
  value?: Coordinates | null;
  onChange: (location: Coordinates | null) => void;
  onSelect?: (location: Coordinates) => void;
  label?: string;
  placeholder?: string;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  onClear?: () => void;
}

interface DropdownPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function LocationSearch({
  value,
  onChange,
  onSelect,
  label,
  placeholder = "Search for a pickup or destination",
  id,
  name,
  className = "",
  disabled = false,
  required = false,
  autoFocus = false,
  onClear,
}: LocationSearchProps) {
  const generatedId = useId();
  const inputId = id ?? `location-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const statusId = `${inputId}-status`;
  const controlRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastValueLabel = useRef(value?.label ?? "");
  const [query, setQuery] = useState(value?.label ?? "");
  const [selectedLabel, setSelectedLabel] = useState(value?.label ?? "");
  const [results, setResults] = useState<Coordinates[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryCount, setRetryCount] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);

  useEffect(() => {
    const nextLabel = value?.label ?? "";
    if (nextLabel !== lastValueLabel.current) {
      lastValueLabel.current = nextLabel;
      setQuery(nextLabel);
      setSelectedLabel(nextLabel);
    }
  }, [value?.label]);

  useEffect(() => {
    const term = query.trim();
    if (!term || term === selectedLabel) {
      setResults([]);
      setIsLoading(false);
      setHasSearched(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setHasSearched(false);
    setError("");
    setResults([]);
    setActiveIndex(-1);

    const timer = window.setTimeout(() => {
      void searchLocations(term, controller.signal)
        .then((locations) => {
          if (controller.signal.aborted) return;
          setResults(locations);
          setHasSearched(true);
          setActiveIndex(locations.length > 0 ? 0 : -1);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setActiveIndex(-1);
          setError(reason instanceof Error ? reason.message : "Unable to search locations right now.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, retryCount, selectedLabel]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownPosition(null);
      return;
    }

    const updatePosition = () => {
      const control = controlRef.current;
      if (!control) return;
      const rect = control.getBoundingClientRect();
      const edge = 10;
      const gap = 7;
      const availableBelow = Math.max(0, window.innerHeight - rect.bottom - gap - edge);
      const availableAbove = Math.max(0, rect.top - gap - edge);
      const placeAbove = availableAbove > availableBelow;
      const available = placeAbove ? availableAbove : availableBelow;
      const width = Math.min(rect.width, Math.max(0, window.innerWidth - edge * 2));
      const maxLeft = Math.max(edge, window.innerWidth - width - edge);
      const left = Math.min(Math.max(edge, rect.left), maxLeft);
      const nextPosition: DropdownPosition = {
        left,
        width,
        maxHeight: Math.min(340, available),
        ...(placeAbove
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
      };
      setDropdownPosition((current) => {
        const unchanged = current
          && current.left === nextPosition.left
          && current.width === nextPosition.width
          && current.maxHeight === nextPosition.maxHeight
          && current.top === nextPosition.top
          && current.bottom === nextPosition.bottom;
        return unchanged ? current : nextPosition;
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [error, hasSearched, isLoading, isOpen, results.length]);

  const closeDropdown = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const selectLocation = (location: Coordinates) => {
    const selectedLocation = { ...location };
    lastValueLabel.current = selectedLocation.label;
    setQuery(selectedLocation.label);
    setSelectedLabel(selectedLocation.label);
    closeDropdown();
    setResults([]);
    onChange(selectedLocation);
    onSelect?.({ ...selectedLocation });
  };

  const clear = () => {
    lastValueLabel.current = "";
    setQuery("");
    setSelectedLabel("");
    setResults([]);
    closeDropdown();
    setIsLoading(false);
    setHasSearched(false);
    setError("");
    onChange(null);
    onClear?.();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    setSelectedLabel("");
    lastValueLabel.current = "";
    onChange(null);
    setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && isOpen && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      selectLocation(results[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (isOpen) {
        closeDropdown();
      } else if (selectedLabel) {
        clear();
      }
    }

    if (event.key === "Tab") {
      closeDropdown();
    }
  };

  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const rootClassName = ["location-search", className].filter(Boolean).join(" ");
  const hasListbox = isOpen && results.length > 0;
  const hasStatus = isOpen && (isLoading || Boolean(error) || (hasSearched && results.length === 0) || (!hasSearched && !selectedLabel));
  const dropdown = isOpen && typeof document !== "undefined" ? (
    <div
      ref={dropdownRef}
      className="location-search__dropdown"
      style={{
        position: "fixed",
        zIndex: 1400,
        left: dropdownPosition?.left ?? 0,
        top: dropdownPosition?.top ?? "auto",
        right: "auto",
        bottom: dropdownPosition?.bottom ?? "auto",
        width: dropdownPosition?.width ?? "auto",
        maxHeight: dropdownPosition?.maxHeight,
      }}
    >
      {isLoading ? (
        <div className="location-search__state" id={statusId} role="status">
          <LoaderCircle size={18} aria-hidden="true" />
          <span>Searching locations…</span>
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="location-search__state location-search__state--error" id={statusId} role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}

      {!isLoading && !error && hasSearched && results.length === 0 ? (
        <div className="location-search__state" id={statusId} role="status">
          <MapPin size={18} aria-hidden="true" />
          <span>No matching locations found in India.</span>
        </div>
      ) : null}

      {!isLoading && !error && !hasSearched && !selectedLabel ? (
        <div className="location-search__state" id={statusId} role="status">
          <MapPin size={18} aria-hidden="true" />
          <span>Keep typing to find a place in India.</span>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="location-search__results" id={listboxId} role="listbox" aria-label="Location suggestions in India">
          {results.map((location, index) => (
            <div
              id={`${listboxId}-option-${index}`}
              className={`location-search__option${activeIndex === index ? " is-active" : ""}`}
              key={`${location.lat}-${location.lon}-${index}`}
              role="option"
              aria-selected={activeIndex === index}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectLocation(location)}
            >
              <span className="location-search__option-icon" aria-hidden="true">
                <MapPin size={17} />
              </span>
              <span className="location-search__option-label">{location.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className={rootClassName}>
      {label ? (
        <label className="location-search__label" htmlFor={inputId}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      <div className="location-search__control" ref={controlRef}>
        <Search className="location-search__search-icon" size={18} aria-hidden="true" />
        <input
          id={inputId}
          name={name}
          className="location-search__input"
          type="text"
          role="combobox"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={hasListbox ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-describedby={hasStatus ? statusId : undefined}
          aria-busy={isLoading}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query && !selectedLabel) setIsOpen(true);
          }}
          onBlur={closeDropdown}
        />
        {isLoading ? <LoaderCircle className="location-search__spinner" size={18} aria-hidden="true" /> : null}
        {selectedLabel && !isLoading ? <Check className="location-search__selected-icon" size={18} aria-hidden="true" /> : null}
        {query && !isLoading ? (
          <button
            className="location-search__clear"
            type="button"
            aria-label={`Clear ${label ?? "location"}`}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

export default LocationSearch;
