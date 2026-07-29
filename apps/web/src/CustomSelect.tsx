import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface CustomSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly CustomSelectOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  dataPath?: string;
  className?: string;
  hideLabel?: boolean;
  compact?: boolean;
  id?: string;
}

export function withCurrentCustomSelectOption(
  options: readonly CustomSelectOption[],
  currentValue: string,
): readonly CustomSelectOption[] {
  if (!currentValue || options.some(({ value }) => value === currentValue)) return options;
  return [{ value: currentValue, label: currentValue, description: '既有資料' }, ...options];
}

export function enabledCustomSelectIndex(
  options: readonly CustomSelectOption[],
  current: number,
  direction: -1 | 1,
): number {
  if (!options.some(({ disabled }) => !disabled)) return -1;
  let candidate = current;
  for (let attempts = 0; attempts < options.length; attempts += 1) {
    candidate = Math.min(Math.max(candidate + direction, 0), options.length - 1);
    if (!options[candidate]?.disabled) return candidate;
    if (candidate === 0 || candidate === options.length - 1) break;
  }
  return current >= 0 && !options[current]?.disabled
    ? current
    : options.findIndex(({ disabled }) => !disabled);
}

function edgeEnabledIndex(options: readonly CustomSelectOption[], fromEnd = false): number {
  if (!fromEnd) return options.findIndex(({ disabled }) => !disabled);
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export function CustomSelect({
  label,
  value,
  onChange,
  options,
  placeholder = '請選擇…',
  required,
  disabled,
  error,
  hint,
  dataPath,
  className = '',
  hideLabel = false,
  compact = false,
  id: providedId,
}: CustomSelectProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const listboxId = `${id}-listbox`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resolvedOptions = useMemo(
    () => withCurrentCustomSelectOption(options, value),
    [options, value],
  );
  const selectedIndex = resolvedOptions.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? resolvedOptions[selectedIndex] : undefined;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    selectedIndex >= 0 && !resolvedOptions[selectedIndex]?.disabled
      ? selectedIndex
      : edgeEnabledIndex(resolvedOptions),
  );
  const [openUpward, setOpenUpward] = useState(false);
  const [alignMenuRight, setAlignMenuRight] = useState(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const selectedIsEnabled = selectedIndex >= 0 && !resolvedOptions[selectedIndex]?.disabled;
    setActiveIndex(selectedIsEnabled ? selectedIndex : edgeEnabledIndex(resolvedOptions));
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = globalThis.innerHeight - rect.bottom;
      setOpenUpward(below < 280 && rect.top > below);
      const menuWidth = Math.min(Math.max(rect.width, 192), globalThis.innerWidth - 32);
      const wouldOverflowRight = rect.left + menuWidth > globalThis.innerWidth - 16;
      setAlignMenuRight(wouldOverflowRight && rect.right - menuWidth >= 16);
    }
  }, [open, resolvedOptions, selectedIndex]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const active = listRef.current?.querySelector<HTMLElement>(
      `[data-custom-select-index="${activeIndex}"]`,
    );
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  function openMenu() {
    if (disabled) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = globalThis.innerHeight - rect.bottom;
      setOpenUpward(below < 280 && rect.top > below);
      const menuWidth = Math.min(Math.max(rect.width, 192), globalThis.innerWidth - 32);
      const wouldOverflowRight = rect.left + menuWidth > globalThis.innerWidth - 16;
      setAlignMenuRight(wouldOverflowRight && rect.right - menuWidth >= 16);
    }
    const nextActive =
      selectedIndex >= 0 && !resolvedOptions[selectedIndex]?.disabled
        ? selectedIndex
        : edgeEnabledIndex(resolvedOptions);
    setActiveIndex(nextActive);
    setOpen(true);
  }

  function choose(index: number) {
    const option = resolvedOptions[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <label
        id={`${id}-label`}
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'mb-1.5 block text-sm font-medium'}
      >
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={`${id}-label`}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        data-wizard-path={dataPath}
        disabled={disabled}
        className={`group flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border bg-white text-left text-slate-950 shadow-sm transition duration-150 hover:border-slate-400 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-55 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-slate-500 ${
          compact ? 'min-h-11 px-3 py-1.5 text-sm' : 'min-h-11 px-3 py-2 text-sm'
        } ${
          open
            ? 'border-teal-600 ring-2 ring-teal-600/20 dark:border-teal-400 dark:ring-teal-400/20'
            : error
              ? 'border-red-600 dark:border-red-500'
              : 'border-slate-300 dark:border-slate-600'
        }`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onBlur={(event) => {
          const nextFocus = event.relatedTarget;
          if (!(nextFocus instanceof Node) || !rootRef.current?.contains(nextFocus)) {
            setOpen(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Tab') {
            setOpen(false);
            return;
          }
          if (event.key === 'Escape') {
            if (open) event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            setActiveIndex((current) =>
              enabledCustomSelectIndex(
                resolvedOptions,
                current,
                event.key === 'ArrowDown' ? 1 : -1,
              ),
            );
            return;
          }
          if (event.key === 'Home' && open) {
            event.preventDefault();
            setActiveIndex(edgeEnabledIndex(resolvedOptions));
            return;
          }
          if (event.key === 'End' && open) {
            event.preventDefault();
            setActiveIndex(edgeEnabledIndex(resolvedOptions, true));
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!open) openMenu();
            else if (activeIndex >= 0) choose(activeIndex);
          }
        }}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-slate-400'}`}>
          {selected?.label ?? placeholder}
        </span>
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition duration-200 group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-700 ${
            open ? 'rotate-180 bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' : ''
          }`}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
            <path
              d="m5 7.5 5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {error ? (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}

      {open ? (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className={`custom-select-menu surface absolute z-50 max-h-72 w-max min-w-full min-w-[12rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl p-1.5 shadow-xl ring-1 ring-black/5 dark:ring-white/10 ${
            openUpward
              ? 'bottom-[calc(100%+0.375rem)] origin-bottom'
              : 'top-[calc(100%+0.375rem)] origin-top'
          } ${alignMenuRight ? 'right-0' : 'left-0'}`}
        >
          {resolvedOptions.length ? (
            resolvedOptions.map((option, index) => {
              const selectedOption = option.value === value;
              const activeOption = index === activeIndex;
              return (
                <div
                  id={`${id}-option-${index}`}
                  key={`${option.value}-${index}`}
                  role="option"
                  aria-selected={selectedOption}
                  aria-disabled={option.disabled || undefined}
                  data-custom-select-index={index}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    option.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                  } ${
                    activeOption
                      ? 'bg-teal-50 text-teal-950 dark:bg-teal-950 dark:text-teal-50'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${
                      selectedOption
                        ? 'bg-teal-700 text-white dark:bg-teal-500 dark:text-slate-950'
                        : 'text-transparent'
                    }`}
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
                      <path
                        d="m4.5 10.5 3.3 3.3 7.7-7.7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
              );
            })
          ) : (
            <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">目前沒有選項。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
