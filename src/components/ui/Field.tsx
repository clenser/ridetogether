import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { AlertCircle } from "lucide-react";

/**
 * Label + control + hint, wired together.
 *
 * The ids are generated here rather than passed in, which is what keeps the
 * `<label for>` and the `aria-describedby` pointing at the right elements as the
 * markup changes. A caller that needs a specific id (a test, or a field
 * referenced by another element) can still override `id`.
 */
interface FieldProps {
  label: string;
  /** Rendered after the label in a muted weight. */
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children?: ReactNode;
}

interface TextFieldProps
  extends FieldProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> {
  leadingIcon?: ReactNode;
  /** Visual field size. Controls stay at least 44px tall on touch. */
  size?: "md" | "lg";
}

export function TextField({
  label,
  optional = false,
  hint,
  error,
  className = "",
  leadingIcon,
  size = "md",
  id,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={["ds-field", className].filter(Boolean).join(" ")}>
      <label className="ds-label" htmlFor={fieldId}>
        {label}
        {optional ? <span className="ds-label__optional">(optional)</span> : null}
      </label>
      <div className={leadingIcon ? "ds-field--icon" : undefined}>
        {leadingIcon}
        <input
          {...inputProps}
          id={fieldId}
          className="ds-input"
          style={size === "lg" ? { minHeight: 52 } : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
      </div>
      {hint ? (
        <span className="ds-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ds-field__error" id={errorId}>
          <AlertCircle size={13} aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface SelectFieldProps extends FieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  children: ReactNode;
}

export function SelectField({
  label,
  optional = false,
  hint,
  error,
  className = "",
  id,
  children,
  ...selectProps
}: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={["ds-field", className].filter(Boolean).join(" ")}>
      <label className="ds-label" htmlFor={fieldId}>
        {label}
        {optional ? <span className="ds-label__optional">(optional)</span> : null}
      </label>
      <select
        {...selectProps}
        id={fieldId}
        className="ds-select"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      >
        {children}
      </select>
      {hint ? (
        <span className="ds-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ds-field__error" id={errorId}>
          <AlertCircle size={13} aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface TextAreaFieldProps
  extends FieldProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {}

export function TextAreaField({
  label,
  optional = false,
  hint,
  error,
  className = "",
  id,
  ...textareaProps
}: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={["ds-field", className].filter(Boolean).join(" ")}>
      <label className="ds-label" htmlFor={fieldId}>
        {label}
        {optional ? <span className="ds-label__optional">(optional)</span> : null}
      </label>
      <textarea
        {...textareaProps}
        id={fieldId}
        className="ds-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <span className="ds-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ds-field__error" id={errorId}>
          <AlertCircle size={13} aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

export default TextField;
