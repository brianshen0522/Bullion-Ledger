import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface DealerOption {
  name: string;
  branches: string[];
}

export function DealerCombobox({
  value, onChange, onBranches, error,
}: {
  value: string;
  onChange: (name: string) => void;
  onBranches: (branches: string[]) => void;
  error?: string;
}) {
  const id = useId();
  const listboxId = `${id}-options`;
  const errorId = `${id}-error`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const { data: options = [] } = useQuery({
    queryKey: ['dealers', query],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      const res = await fetch(`/api/dealers?${params.toString()}`, { signal });
      if (!res.ok) throw new Error('Failed to fetch dealers');
      return res.json() as Promise<DealerOption[]>;
    },
    placeholderData: (prev) => prev ?? [],
  });

  const filtered = query
    ? options
    : options.slice(0, 20);
  const isNew = query && !options.some((o) => o.name.toLowerCase() === query.toLowerCase());

  function choose(option: DealerOption) {
    onChange(option.name);
    onBranches(option.branches);
    setOpen(false);
    setQuery('');
  }

  function chooseCustom(text: string) {
    onChange(text.trim());
    onBranches([]);
    setOpen(false);
    setQuery('');
  }

  const visibleValue = open ? query : value;

  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="block space-y-1.5 text-sm">
        <span className="font-medium">購買商家</span>
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          data-wizard-path="transaction.dealerName"
          className="w-full min-w-0 rounded-lg border px-3 py-2 aria-[invalid=true]:border-red-600"
          value={visibleValue}
          placeholder="例如：銀樓、銀行、交易平台"
          autoComplete="off"
          maxLength={128}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onClick={() => { if (!open) { setOpen(true); setQuery(''); } }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            onChange(event.target.value);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              setQuery('');
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) { setOpen(true); return; }
              setActiveIndex((c) =>
                Math.min(Math.max(c + (event.key === 'ArrowDown' ? 1 : -1), 0), Math.max(filtered.length + (isNew ? 1 : 0) - 1, 0)),
              );
              return;
            }
            if (event.key === 'Home' && open) { event.preventDefault(); setActiveIndex(0); return; }
            if (event.key === 'End' && open) { event.preventDefault(); setActiveIndex(Math.max(filtered.length + (isNew ? 1 : 0) - 1, 0)); return; }
            if (event.key === 'Enter' && open) {
              if (isNew && activeIndex >= filtered.length) {
                chooseCustom(query);
              } else if (filtered[activeIndex]) {
                choose(filtered[activeIndex]!);
              }
            }
          }}
        />
      </label>
      {error ? <p id={errorId} className="mt-1 text-xs text-danger">{error}</p> : null}
      {open && (
        <div className="surface absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg p-1 shadow-lg">
          <ul id={listboxId} role="listbox" aria-label="購買商家選項">
            {filtered.map((option, index) => (
              <li key={option.name} role="presentation">
                <button
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.name === value}
                  className={`min-h-11 w-full rounded-md px-3 py-2 text-left text-sm ${
                    activeIndex === index
                      ? 'bg-teal-50 text-slate-950 dark:bg-teal-950 dark:text-white'
                      : 'interactive-muted'
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span className="block font-medium">{option.name}</span>
                  {option.branches.length > 0 && (
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      分店：{option.branches.join('、')}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {isNew && (
              <li role="presentation">
                <button
                  id={`${id}-option-${filtered.length}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  className={`min-h-11 w-full rounded-md px-3 py-2 text-left text-sm ${
                    activeIndex >= filtered.length
                      ? 'bg-teal-50 text-slate-950 dark:bg-teal-950 dark:text-white'
                      : 'interactive-muted'
                  }`}
                  onMouseEnter={() => setActiveIndex(filtered.length)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseCustom(query)}
                >
                  <span className="block font-medium">新增「{query}」</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">輸入新的商家名稱</span>
                </button>
              </li>
            )}
          </ul>
          {filtered.length === 0 && !isNew && (
            <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">
              輸入商家名稱開始搜尋
            </p>
          )}
        </div>
      )}
    </div>
  );
}
