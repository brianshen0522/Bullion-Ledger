import { useId } from 'react';

import { CustomSelect, type CustomSelectOption } from '../CustomSelect.js';
import type { WizardValidationIssue } from './types.js';

export function issueForPath(
  issues: readonly WizardValidationIssue[],
  path: string,
): WizardValidationIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

interface FieldProps {
  label: string;
  path: string;
  value: string;
  onChange: (value: string) => void;
  issues: readonly WizardValidationIssue[];
  type?: string;
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  className?: string;
}

export function WizardField({
  label,
  path,
  value,
  onChange,
  issues,
  type = 'text',
  required,
  min,
  max,
  step,
  inputMode,
  autoComplete,
  maxLength,
  placeholder,
  hint,
  className = '',
}: FieldProps) {
  const id = useId();
  const fieldIssue = issueForPath(issues, path);
  const descriptionId = fieldIssue ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <label className={`block min-w-0 space-y-1.5 text-sm ${className}`}>
      <span className="font-medium">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </span>
      <input
        id={id}
        data-wizard-path={path}
        className="w-full min-w-0 rounded-lg border px-3 py-2 aria-[invalid=true]:border-red-600"
        type={type}
        value={value}
        min={min}
        max={max}
        step={step}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
        required={required}
        aria-invalid={fieldIssue ? true : undefined}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.value)}
      />
      {fieldIssue ? (
        <span id={`${id}-error`} className="block text-xs text-danger">
          {fieldIssue.message}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="block text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

interface SelectProps {
  label: string;
  path: string;
  value: string;
  onChange: (value: string) => void;
  issues: readonly WizardValidationIssue[];
  options: readonly CustomSelectOption[];
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
}

export function WizardSelect({
  label,
  path,
  value,
  onChange,
  issues,
  options,
  required,
  disabled,
  placeholder,
  hint,
  className = '',
}: SelectProps) {
  const fieldIssue = issueForPath(issues, path);
  return (
    <CustomSelect
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      hint={hint}
      error={fieldIssue?.message}
      dataPath={path}
      className={className}
    />
  );
}

export function WizardTextarea({
  label,
  path,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string;
  path: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <textarea
        id={id}
        data-wizard-path={path}
        className="min-h-24 w-full rounded-lg border px-3 py-2"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function WizardErrorSummary({ issues }: { issues: readonly WizardValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      tabIndex={-1}
      data-wizard-error-summary
      className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
    >
      <p className="font-medium">請先修正以下內容：</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {issues.map((issue) => (
          <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}
