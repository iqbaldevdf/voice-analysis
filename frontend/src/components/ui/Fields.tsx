import type {
  ChangeEventHandler,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

type FieldProps = {
  label: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, className = "", children }: FieldProps) {
  return (
    <label className={`ui-field ${className}`.trim()} htmlFor={htmlFor}>
      <span className="ui-field-label">{label}</span>
      {children}
    </label>
  );
}

type SearchFieldProps = {
  id?: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  className?: string;
};

export function SearchField({
  id,
  value,
  onChange,
  placeholder = "Search…",
  className = "",
}: SearchFieldProps) {
  return (
    <label className={`ui-field ui-field-search ${className}`.trim()} htmlFor={id}>
      <span className="ui-field-label">Search</span>
      <span className="ui-control ui-control-search">
        <span className="ui-search-icon" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <input
          id={id}
          type="search"
          className="ui-input"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete="off"
        />
      </span>
    </label>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  className?: string;
  controlClassName?: string;
};

export function TextField({
  label,
  id,
  className = "",
  controlClassName = "",
  ...inputProps
}: TextFieldProps) {
  return (
    <Field label={label} htmlFor={id} className={className}>
      <span className={`ui-control ${controlClassName}`.trim()}>
        <input id={id} className="ui-input" {...inputProps} />
      </span>
    </Field>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
  label: string;
  className?: string;
  children: ReactNode;
};

export function SelectField({
  label,
  id,
  className = "",
  children,
  ...selectProps
}: SelectFieldProps) {
  return (
    <Field label={label} htmlFor={id} className={className}>
      <span className="ui-control ui-control-select">
        <select id={id} className="ui-input ui-select" {...selectProps}>
          {children}
        </select>
        <span className="ui-select-chevron" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 4.5L6 8L9.5 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </span>
    </Field>
  );
}

type CheckboxFieldProps = {
  label: string;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  className?: string;
  id?: string;
};

export function CheckboxField({
  label,
  checked,
  onChange,
  className = "",
  id,
}: CheckboxFieldProps) {
  return (
    <label className={`ui-check ${className}`.trim()} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
      <span className="ui-check-box" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.2L4.8 8.5L9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="ui-check-label">{label}</span>
    </label>
  );
}
