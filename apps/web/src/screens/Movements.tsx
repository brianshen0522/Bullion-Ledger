import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { api, isApiError, type Metal } from '../api.js';
import { CustomSelect } from '../CustomSelect.js';
import { Field } from './Init.js';
import { WEIGHT_UNITS, WEIGHT_UNIT_LABELS, formatMoney, type WeightUnit } from '../units.js';
import {
  MOVEMENT_LABELS,
  movementAmount,
  movementLabel,
  realizedOf,
  type Movement,
  type MovementType,
} from './movements-model.js';

const FILTERS: { id: 'ALL' | MovementType; label: string }[] = [
  { id: 'ALL', label: '全部' },
  { id: 'SALE', label: MOVEMENT_LABELS.SALE },
  { id: 'GIFT_OUT', label: MOVEMENT_LABELS.GIFT_OUT },
  { id: 'GIFT_IN', label: MOVEMENT_LABELS.GIFT_IN },
  { id: 'LOST', label: MOVEMENT_LABELS.LOST },
  { id: 'STORAGE_TRANSFER', label: MOVEMENT_LABELS.STORAGE_TRANSFER },
];

/** Asset lifecycle history and gift intake (PRD §6.4). */
export function MovementsScreen() {
  const [filter, setFilter] = useState<'ALL' | MovementType>('ALL');
  const [showGiftIn, setShowGiftIn] = useState(false);

  const movements = useQuery<Movement[]>({
    queryKey: ['movements'],
    queryFn: () => api.get<Movement[]>('/movements'),
  });

  const rows = (movements.data ?? []).filter(
    (movement) => filter === 'ALL' || movement.type === filter,
  );

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">異動紀錄</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            售出、贈與、收到贈與、遺失與位置移轉。每一筆都會同步更新庫存餘額。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowGiftIn((open) => !open)}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm hover:bg-teal-800 dark:hover:bg-teal-600"
        >
          {showGiftIn ? '收起' : '＋ 記錄收到的贈與'}
        </button>
      </div>

      {showGiftIn && <GiftInForm onDone={() => setShowGiftIn(false)} />}

      <div role="group" aria-label="篩選類型" className="flex flex-wrap gap-1">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            aria-pressed={filter === entry.id}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filter === entry.id ? 'bg-accent text-white shadow-sm' : 'interactive-muted'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <section className="surface min-w-0 rounded-xl p-4">
        {movements.isLoading && <p className="text-sm text-slate-500">載入中…</p>}
        {movements.isError && (
          <p role="alert" className="text-danger text-sm">
            無法載入異動紀錄：{(movements.error as Error).message}
          </p>
        )}
        {!movements.isLoading && rows.length === 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {filter === 'ALL' ? '尚無任何異動紀錄。' : '這個類型還沒有紀錄。'}
          </p>
        )}
        {/*
          Seven columns cannot be read on a phone; the table used to scroll
          sideways, hiding the amount and realized-gain columns off-screen.
        */}
        {rows.length > 0 && (
          <ol className="space-y-3 lg:hidden">
            {rows.map((movement) => {
              const amount = movementAmount(movement);
              const realized = realizedOf(movement);
              return (
                <li
                  key={movement.id}
                  className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="break-words font-medium [overflow-wrap:anywhere]">
                      {movement.name}
                      <span className="ml-1 text-xs text-slate-500">{movement.metalCode}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-800">
                      {movementLabel(movement.type)}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <MovementFact
                      label="日期"
                      value={new Date(movement.occurredAt).toLocaleDateString()}
                    />
                    <MovementFact
                      label="數量／純重"
                      value={
                        movement.quantity > 0
                          ? `${movement.quantity} 件 · ${trim(movement.fineWeightGrams)} g`
                          : '—'
                      }
                    />
                    <MovementFact label="對象" value={movement.counterparty ?? '—'} />
                    <MovementFact
                      label="金額"
                      value={
                        amount.value === null
                          ? movement.toStorageLocation
                            ? `→ ${movement.toStorageLocation}`
                            : '—'
                          : `${amount.label} ${formatMoney(amount.value, movement.currency ?? '')}`
                      }
                    />
                    <MovementFact
                      label="已實現損益"
                      value={
                        realized === null
                          ? '不適用'
                          : formatMoney(realized.toFixed(2), movement.currency ?? '')
                      }
                      tone={realized === null ? undefined : realized.isNegative() ? 'loss' : 'gain'}
                      wide
                    />
                  </dl>
                </li>
              );
            })}
          </ol>
        )}
        {rows.length > 0 && (
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="text-left text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3">日期</th>
                  <th className="px-3">類型</th>
                  <th className="px-3">商品</th>
                  <th className="px-3">數量／純重</th>
                  <th className="px-3">對象</th>
                  <th className="px-3">金額</th>
                  <th className="pl-3">已實現損益</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((movement) => {
                  const amount = movementAmount(movement);
                  const realized = realizedOf(movement);
                  return (
                    <tr
                      key={movement.id}
                      className="border-t border-slate-200 dark:border-slate-700"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {new Date(movement.occurredAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 whitespace-nowrap">{movementLabel(movement.type)}</td>
                      <td className="px-3">
                        {movement.name}
                        <span className="ml-1 text-xs text-slate-500">{movement.metalCode}</span>
                      </td>
                      <td className="px-3 tabular-nums whitespace-nowrap">
                        {movement.quantity > 0
                          ? `${movement.quantity} 件 · ${trim(movement.fineWeightGrams)} g`
                          : '—'}
                      </td>
                      <td className="px-3">{movement.counterparty ?? '—'}</td>
                      <td className="px-3 tabular-nums whitespace-nowrap">
                        {amount.value === null
                          ? movement.toStorageLocation
                            ? `→ ${movement.toStorageLocation}`
                            : '—'
                          : `${amount.label} ${formatMoney(amount.value, movement.currency ?? '')}`}
                      </td>
                      <td className="pl-3 tabular-nums whitespace-nowrap">
                        {realized === null ? (
                          <span className="text-slate-500">不適用</span>
                        ) : (
                          <span
                            className={
                              realized.isNegative()
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-teal-700 dark:text-teal-400'
                            }
                          >
                            {formatMoney(realized.toFixed(2), movement.currency ?? '')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          贈與不計入已實現損益 — 把金屬送給別人不是虧損，因此只記錄當時市值。
        </p>
      </section>
    </div>
  );
}

function MovementFact({
  label,
  value,
  tone,
  wide = false,
}: {
  label: string;
  value: string;
  tone?: 'gain' | 'loss';
  wide?: boolean;
}) {
  const toneClass =
    tone === 'loss'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'gain'
        ? 'text-teal-700 dark:text-teal-400'
        : '';
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`break-words font-medium tabular-nums [overflow-wrap:anywhere] ${toneClass}`}>
        {value}
      </dd>
    </div>
  );
}

/** PRD §6.4 收到贈與: an acquisition with no purchase price. */
function GiftInForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const metals = useQuery<Metal[]>({
    queryKey: ['metals'],
    queryFn: () => api.get<Metal[]>('/metals'),
  });

  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [metalCode, setMetalCode] = useState('XAU');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitWeight, setUnitWeight] = useState('1');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('g');
  const [purity, setPurity] = useState('0.9999');
  const [counterparty, setCounterparty] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.post('/assets/gift-in', {
        occurredAt: new Date(occurredAt).toISOString(),
        metalCode,
        name: name.trim(),
        quantity: Number(quantity),
        unitWeight,
        weightUnit,
        purity,
        counterparty: counterparty.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['movements'] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      ]);
      onDone();
    },
    onError: (requestError) =>
      setError(isApiError(requestError) ? requestError.message : '無法記錄贈與。'),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onDone]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('請輸入商品名稱。');
      return;
    }
    submit.mutate();
  }

  return (
    /*
      A nine-field form used to open inline and push the movement list off the
      screen. It is a bottom sheet now, the same shape as the disposal dialog:
      it sits over the list, and the list is still there when it closes.
    */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gift-in-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDone();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="surface max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto overscroll-contain rounded-2xl p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="gift-in-title" className="text-lg font-semibold">
              記錄收到的贈與
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              成本基礎會用<strong>收到當下的市價</strong>
              自動計算，而不是零。用零會讓整筆價值都變成獲利，報酬率就失去意義。
            </p>
          </div>
          <button
            type="button"
            onClick={onDone}
            aria-label="關閉"
            className="interactive-muted -mr-2 -mt-2 shrink-0 rounded-lg px-3"
          >
            ×
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="收到日期"
            type="datetime-local"
            value={occurredAt}
            onChange={setOccurredAt}
            required
          />
          <CustomSelect
            id="gift-metal"
            label="金屬"
            value={metalCode}
            onChange={setMetalCode}
            options={(metals.data ?? []).map((metal) => ({
              value: metal.code,
              label: `${metal.code} — ${metal.name}`,
            }))}
          />
          <Field label="商品名稱" value={name} onChange={setName} required />
          <Field label="數量" type="number" value={quantity} onChange={setQuantity} required />
          <Field
            label="單件重量"
            type="number"
            value={unitWeight}
            onChange={setUnitWeight}
            required
          />
          <CustomSelect
            id="gift-unit"
            label="重量單位"
            value={weightUnit}
            onChange={(next) => setWeightUnit(next as WeightUnit)}
            options={WEIGHT_UNITS.map((value) => ({ value, label: WEIGHT_UNIT_LABELS[value] }))}
          />
          <Field label="純度（0-1）" value={purity} onChange={setPurity} required />
          <Field label="贈與人（選填）" value={counterparty} onChange={setCounterparty} />
          <Field label="備註（選填）" value={notes} onChange={setNotes} />
        </div>
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={submit.isPending}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm disabled:opacity-50"
          >
            {submit.isPending ? '記錄中…' : '記錄贈與'}
          </button>
          <button
            type="button"
            onClick={onDone}
            disabled={submit.isPending}
            className="interactive-muted rounded-lg px-4 py-2 font-medium disabled:opacity-30"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

function trim(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(4))) : value;
}
