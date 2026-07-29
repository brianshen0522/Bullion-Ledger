import { useEffect, useId, useMemo, useState } from 'react';

import {
  filterReferenceOptions,
  withCurrentReferenceOption,
  type ReferenceOption,
} from './reference-options.js';

export interface SearchableSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ReferenceOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  /** Applied as `data-wizard-path` so Wizard error focus continues to work. */
  dataPath?: string;
  className?: string;
  id?: string;
}

export function nextSearchableSelectIndex(
  current: number,
  optionCount: number,
  direction: -1 | 1,
): number {
  if (optionCount <= 0) return 0;
  return Math.min(Math.max(current + direction, 0), optionCount - 1);
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = '請選擇…',
  searchPlaceholder = '輸入代碼或名稱搜尋',
  required,
  disabled,
  error,
  hint,
  dataPath,
  className = '',
  id: providedId,
}: SearchableSelectProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const listboxId = `${id}-options`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const resolvedOptions = useMemo(
    () => withCurrentReferenceOption(options, value),
    [options, value],
  );
  const selected = resolvedOptions.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(
    () => filterReferenceOptions(resolvedOptions, query),
    [query, resolvedOptions],
  );

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  function openMenu() {
    if (disabled) return;
    setQuery('');
    setOpen(true);
    const selectedIndex = resolvedOptions.findIndex((option) => option.value === value);
    setActiveIndex(Math.max(selectedIndex, 0));
  }

  function closeMenu() {
    setOpen(false);
    setQuery('');
  }

  function choose(option: ReferenceOption) {
    onChange(option.value);
    closeMenu();
  }

  const visibleValue = open ? query : (selected?.label ?? '');

  return (
    <div className={`relative min-w-0 ${className}`}>
      <label htmlFor={id} className="block space-y-1.5 text-sm">
        <span className="font-medium">
          {label}
          {required ? <span className="ml-1 text-danger">*</span> : null}
        </span>
        <div className="relative">
          <input
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={
              open && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined
            }
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            data-wizard-path={dataPath}
            className="min-h-11 w-full min-w-0 rounded-lg border py-2 pl-3 pr-10 aria-[invalid=true]:border-red-600"
            value={visibleValue}
            placeholder={open ? searchPlaceholder : placeholder}
            required={required}
            disabled={disabled}
            autoComplete="off"
            onFocus={openMenu}
            onClick={() => {
              if (!open) openMenu();
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActiveIndex(0);
            }}
            onBlur={() => closeMenu()}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                if (open) event.preventDefault();
                closeMenu();
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!open) {
                  openMenu();
                  return;
                }
                setActiveIndex((current) =>
                  nextSearchableSelectIndex(
                    current,
                    filtered.length,
                    event.key === 'ArrowDown' ? 1 : -1,
                  ),
                );
                return;
              }
              if (event.key === 'Home' && open) {
                event.preventDefault();
                setActiveIndex(0);
                return;
              }
              if (event.key === 'End' && open) {
                event.preventDefault();
                setActiveIndex(Math.max(filtered.length - 1, 0));
                return;
              }
              if (event.key === 'Enter' && open && filtered[activeIndex]) {
                event.preventDefault();
                choose(filtered[activeIndex]!);
              }
            }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500 dark:text-slate-400"
          >
            {open ? '⌃' : '⌄'}
          </span>
        </div>
      </label>

      {error ? (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}

      {open && (
        <div className="surface absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg p-1 shadow-lg">
          <ul id={listboxId} role="listbox" aria-label={`${label}選項`}>
            {filtered.map((option, index) => (
              <li key={option.value} role="presentation">
                <button
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.value === value}
                  className={`min-h-11 w-full rounded-md px-3 py-2 text-left text-sm ${
                    activeIndex === index
                      ? 'bg-teal-50 text-slate-950 dark:bg-teal-950 dark:text-white'
                      : 'interactive-muted'
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span className="block font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && (
            <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">
              找不到符合「{query}」的選項。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
