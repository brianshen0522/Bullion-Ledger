import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

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
        {rows.length > 0 && (
          <div className="overflow-x-auto">
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
    <form onSubmit={handleSubmit} className="surface space-y-4 rounded-xl p-4">
      <div>
        <h2 className="font-medium">記錄收到的贈與</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          成本基礎會用<strong>收到當下的市價</strong>
          自動計算，而不是零。用零會讓整筆價值都變成獲利，報酬率就失去意義。
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      <button
        type="submit"
        disabled={submit.isPending}
        className="rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm disabled:opacity-50"
      >
        {submit.isPending ? '記錄中…' : '記錄贈與'}
      </button>
    </form>
  );
}

function trim(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(4))) : value;
}
