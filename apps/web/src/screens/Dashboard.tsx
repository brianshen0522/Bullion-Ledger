import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isWeightUnit } from '@bullion-ledger/shared';
import { useState } from 'react';

import { api, type CurrencyCost, type DashboardSummary } from '../api.js';
import { CustomSelect } from '../CustomSelect.js';
import {
  describePremium,
  formatPricePerUnit,
  signTone,
  valuationNotes,
} from './dashboard-model.js';
import {
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABELS,
  formatMoney,
  formatGrams,
  type WeightUnit,
} from '../units.js';

export function DashboardScreen() {
  const queryClient = useQueryClient();
  const [pendingUnit, setPendingUnit] = useState<WeightUnit | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
  });
  const savePreference = useMutation({
    mutationFn: (weightUnit: WeightUnit) =>
      api.patch<{ weightUnit: WeightUnit }>('/dashboard/preferences', { weightUnit }),
    onMutate: (weightUnit) => {
      setPendingUnit(weightUnit);
      setSaveError(null);
    },
    onSuccess: ({ weightUnit }) => {
      queryClient.setQueryData<DashboardSummary>(['dashboard-summary'], (current) =>
        current ? { ...current, weightUnit } : current,
      );
      setPendingUnit(null);
    },
    onError: (requestError) => {
      setPendingUnit(null);
      setSaveError(requestError instanceof Error ? requestError.message : '無法儲存重量顯示單位。');
    },
  });

  if (isLoading) return <State text="Loading dashboard…" />;
  if (isError)
    return <State text={`Failed to load dashboard: ${(error as Error).message}`} retry={refetch} />;
  if (!data) return <State text="No dashboard data available." />;

  // Keep a rolling deployment or stale development cache from passing an
  // unknown unit into Decimal conversion before the refreshed summary lands.
  const unit = pendingUnit ?? (isWeightUnit(data.weightUnit) ? data.weightUnit : 'g');
  const empty = data.heldAssetLots === 0;
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="text-right">
          <UnitSwitcher
            value={unit}
            disabled={savePreference.isPending}
            onChange={(next) => savePreference.mutate(next)}
          />
          {savePreference.isPending && (
            <p role="status" className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              儲存中…
            </p>
          )}
          {saveError && (
            <p role="alert" className="text-danger mt-1 max-w-64 text-xs">
              {saveError}
            </p>
          )}
        </div>
      </div>

      {empty && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No assets held yet. Create a product definition and record a purchase to see live data
          here.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        <Card label="Cost basis by currency" value={formatCurrencyCosts(data.costByCurrency)} />
        <Card label="Asset lots held" value={String(data.heldAssetLots)} />
        <Card label="Units held" value={String(data.heldAssetUnits)} />
        <Card label="Purchases" value={String(data.purchaseCount)} />
        <Card
          label={`Intrinsic value (${data.valuationCurrency})`}
          value={
            data.intrinsicValue === null
              ? '尚無行情'
              : formatMoney(data.intrinsicValue, data.valuationCurrency)
          }
          muted={data.intrinsicValue === null}
        />
        <Card
          label={`Unrealized P&L (${data.valuationCurrency})`}
          value={
            data.unrealizedPnl === null
              ? '尚無法計算'
              : formatMoney(data.unrealizedPnl, data.valuationCurrency)
          }
          muted={data.unrealizedPnl === null}
          tone={signTone(data.unrealizedPnl)}
        />
        <Card
          label="Return rate"
          value={data.returnRate === null ? '—' : `${data.returnRate}%`}
          muted={data.returnRate === null}
          tone={signTone(data.returnRate)}
        />
        <Card
          label="Premium paid"
          value={describePremium(data, (amount, currency) => formatMoney(amount, currency))}
          muted={data.premiumPaid === null}
        />
        <Card
          label="Held fine weight"
          value={
            data.byMetal
              .map((m) => `${m.code}: ${formatGrams(m.fineWeightGrams, unit)}`)
              .join(' / ') || '—'
          }
        />
      </div>

      <ValuationNotes data={data} />

      {data.valuationByMetal.some((metal) => metal.pricePerGram !== null) && (
        <section className="surface min-w-0 rounded-xl p-4" aria-labelledby="market-valuation">
          <h2 id="market-valuation" className="mb-3 font-medium">
            現貨估值
          </h2>
          <ul className="space-y-2 text-sm">
            {data.valuationByMetal.map((metal) => (
              <li
                key={metal.code}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
              >
                <span className="font-medium">{metal.code}</span>
                <span className="text-slate-600 dark:text-slate-300">
                  {metal.pricePerGram === null
                    ? '尚無行情'
                    : formatPricePerUnit(metal.pricePerGram, unit, data.valuationCurrency)}
                </span>
                <span className="tabular-nums">
                  {metal.intrinsicValue === null
                    ? '—'
                    : formatMoney(metal.intrinsicValue, data.valuationCurrency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="surface min-w-0 rounded-xl p-4" aria-labelledby="holding-breakdown">
        <h2 id="holding-breakdown" className="mb-3 font-medium">
          Holding breakdown
        </h2>

        <div className="space-y-3 sm:hidden">
          {data.byMetal.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No holdings.</p>
          )}
          {data.byMetal.map((metal) => (
            <article
              key={metal.code}
              className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <h3 className="font-semibold">{metal.code}</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <Metric label="Fine weight" value={formatGrams(metal.fineWeightGrams, unit)} />
                <Metric label="Lots" value={String(metal.heldAssetLots)} />
                <Metric label="Units" value={metal.heldAssetUnits} />
                <Metric
                  label="Allocated cost"
                  value={formatCurrencyCosts(metal.costByCurrency)}
                  wide
                />
              </dl>
            </article>
          ))}
        </div>

        <div className="hidden sm:block">
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th scope="col" className="w-[12%] py-2 pr-2">
                  Metal
                </th>
                <th scope="col" className="w-[26%] px-2">
                  Fine weight ({WEIGHT_UNIT_LABELS[unit]})
                </th>
                <th scope="col" className="w-[12%] px-2">
                  Lots
                </th>
                <th scope="col" className="w-[15%] px-2">
                  Units
                </th>
                <th scope="col" className="w-[35%] pl-2">
                  Allocated cost by currency
                </th>
              </tr>
            </thead>
            <tbody>
              {data.byMetal.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-slate-500 dark:text-slate-400">
                    No holdings.
                  </td>
                </tr>
              )}
              {data.byMetal.map((metal) => (
                <tr key={metal.code} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="py-3 pr-2 font-medium">{metal.code}</td>
                  <td className="break-words px-2 py-3">
                    {formatGrams(metal.fineWeightGrams, unit)}
                  </td>
                  <td className="break-words px-2 py-3">{metal.heldAssetLots}</td>
                  <td className="break-words px-2 py-3">{metal.heldAssetUnits}</td>
                  <td className="break-words py-3 pl-2 [overflow-wrap:anywhere]">
                    {formatCurrencyCosts(metal.costByCurrency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: 'gain' | 'loss';
}) {
  const toneClass =
    tone === 'gain'
      ? 'text-teal-700 dark:text-teal-400'
      : tone === 'loss'
        ? 'text-red-700 dark:text-red-400'
        : '';
  return (
    <div className="surface min-w-0 rounded-xl p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={`mt-1 break-words text-lg font-medium [overflow-wrap:anywhere] ${
          muted ? 'text-slate-500 dark:text-slate-400' : toneClass
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Explains any absent figure and how stale the prices behind it are. */
function ValuationNotes({ data }: { data: DashboardSummary }) {
  const notes = valuationNotes(data);
  if (notes.length === 0) return null;

  return (
    <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
      {notes.join(' · ')}
    </p>
  );
}

function UnitSwitcher({
  value,
  onChange,
  disabled,
}: {
  value: WeightUnit;
  onChange: (u: WeightUnit) => void;
  disabled?: boolean;
}) {
  return (
    <CustomSelect
      label="重量顯示單位"
      hideLabel
      compact
      value={value}
      disabled={disabled}
      onChange={(nextValue) => onChange(nextValue as WeightUnit)}
      options={WEIGHT_UNITS.map((unit) => ({
        value: unit,
        label: WEIGHT_UNIT_LABELS[unit],
      }))}
    />
  );
}

function Metric({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="break-words font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function formatCurrencyCosts(costs: CurrencyCost[]): string {
  if (costs.length === 0) return '—';
  return costs.map(({ currency, totalCost }) => formatMoney(totalCost, currency)).join(' / ');
}

function State({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="py-10 text-center sm:p-8">
      <p className="text-slate-600 dark:text-slate-300">{text}</p>
      {retry && (
        <button
          type="button"
          onClick={() => retry()}
          className="mt-2 rounded-lg px-4 font-medium text-accent underline-offset-4 hover:underline dark:text-teal-400"
        >
          Retry
        </button>
      )}
    </div>
  );
}
