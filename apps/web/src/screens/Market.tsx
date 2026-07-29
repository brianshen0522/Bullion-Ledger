import { useQuery } from '@tanstack/react-query';
import { Suspense, lazy, useMemo, useState } from 'react';

import { fromGrams, pricePerUnitFromGram } from '@bullion-ledger/shared';

import { api, type Metal } from '../api.js';
import { CustomSelect } from '../CustomSelect.js';
import { useTheme } from '../ThemeProvider.js';
import { WEIGHT_UNITS, WEIGHT_UNIT_LABELS, formatMoney, type WeightUnit } from '../units.js';
import {
  MARKET_RANGES,
  formatPremiumRate,
  groupNearbyMarkers,
  rangeWindow,
  toChartSeries,
  toLineValue,
  toMarkerSeries,
  type CostLines,
  type MarketRangeId,
  type PricePoint,
  type PurchaseMarker,
} from './market-model.js';

/**
 * ECharts roughly triples the bundle, and only this screen draws a chart, so it
 * is fetched on demand rather than by everyone who opens the Dashboard.
 */
const MarketChart = lazy(async () => ({
  default: (await import('./MarketChart.js')).MarketChart,
}));

interface HistoryResponse {
  metal: string;
  from: string;
  to: string;
  points: PricePoint[];
}

interface MarkerResponse {
  metalCode: string;
  markers: PurchaseMarker[];
  costLines: CostLines;
}

interface ProviderStatusResponse {
  displayCurrency: string;
  supportedMetals: string[];
  providers: { provider: string; attribution: string; lastSuccessAt: string | null }[];
}

interface LatestPrice {
  metalCode: string;
  fxRate: string | null;
  timestamp: string;
  provider: string | null;
}

/**
 * Market history and buy points (PRD §11.4).
 *
 * The chart's job is to answer one question — where did I buy relative to the
 * market — so a buy point is drawn at the price actually paid per gram rather
 * than on the spot line. The vertical gap between a marker and the line is the
 * premium, visible without reading a number.
 */
export function MarketScreen() {
  const { resolvedTheme } = useTheme();
  const [metalCode, setMetalCode] = useState('XAU');
  const [range, setRange] = useState<MarketRangeId>('3m');
  const [unit, setUnit] = useState<WeightUnit>('g');
  const [currency, setCurrency] = useState<string | null>(null);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);

  const metals = useQuery<Metal[]>({
    queryKey: ['metals'],
    queryFn: () => api.get<Metal[]>('/metals'),
  });
  const status = useQuery<ProviderStatusResponse>({
    queryKey: ['market-provider-status'],
    queryFn: () => api.get<ProviderStatusResponse>('/market/providers/status'),
  });
  const latest = useQuery<LatestPrice[]>({
    queryKey: ['market-latest'],
    queryFn: () => api.get<LatestPrice[]>('/market/latest'),
  });

  const window = useMemo(() => rangeWindow(range), [range]);
  const history = useQuery<HistoryResponse>({
    queryKey: ['market-history', metalCode, window.from.toISOString(), window.to.toISOString()],
    queryFn: () =>
      api.get<HistoryResponse>(
        `/market/history?metal=${encodeURIComponent(metalCode)}` +
          `&from=${encodeURIComponent(window.from.toISOString())}` +
          `&to=${encodeURIComponent(window.to.toISOString())}`,
      ),
  });
  const markers = useQuery<MarkerResponse>({
    queryKey: ['market-markers', metalCode],
    queryFn: () =>
      api.get<MarkerResponse>(`/market/purchase-markers?metal=${encodeURIComponent(metalCode)}`),
  });

  const displayCurrency = currency ?? status.data?.displayCurrency ?? 'TWD';
  const fxRate = latest.data?.find((price) => price.fxRate !== null)?.fxRate ?? null;
  const quoteCurrency = history.data?.points[0]?.quoteCurrency ?? 'USD';
  const currencyOptions = uniqueCurrencies(quoteCurrency, status.data?.displayCurrency ?? 'TWD');

  const series = useMemo(
    () => toChartSeries(history.data?.points ?? [], unit, displayCurrency, fxRate),
    [history.data, unit, displayCurrency, fxRate],
  );
  const plottedMarkers = useMemo(
    () => toMarkerSeries(markers.data?.markers ?? [], unit, displayCurrency, fxRate),
    [markers.data, unit, displayCurrency, fxRate],
  );
  const markerGroups = useMemo(() => groupNearbyMarkers(plottedMarkers), [plottedMarkers]);

  const lines = markers.data?.costLines;
  const averageCost = toLineValue(
    lines?.averageCostPerGram ?? null,
    lines?.currency ?? null,
    unit,
    displayCurrency,
    fxRate,
  );
  const averageSpot = toLineValue(
    lines?.averageSpotAtPurchase ?? null,
    lines?.currency ?? null,
    unit,
    displayCurrency,
    fxRate,
  );

  const loading = history.isLoading || markers.isLoading;
  const error = history.isError ? (history.error as Error).message : null;
  const attribution = status.data?.providers.find((p) => p.lastSuccessAt !== null)?.attribution;
  const lastUpdated = latest.data?.find((price) => price.metalCode === metalCode)?.timestamp;

  return (
    <div className="min-w-0 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">市場與買點</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          歷史現貨走勢，以及你每一筆買入的位置。買點畫在「實際每公克付出的價格」，與線的落差就是溢價。
        </p>
      </div>

      <div className="surface flex flex-wrap items-end gap-3 rounded-xl p-4">
        <div className="min-w-32">
          <CustomSelect
            id="market-metal"
            label="金屬"
            value={metalCode}
            onChange={setMetalCode}
            options={(metals.data ?? [{ code: 'XAU', name: 'Gold' }]).map((metal) => ({
              value: metal.code,
              label: `${metal.code} — ${metal.name}`,
            }))}
          />
        </div>
        <div className="min-w-28">
          <CustomSelect
            id="market-currency"
            label="幣別"
            value={displayCurrency}
            onChange={setCurrency}
            options={currencyOptions.map((code) => ({ value: code, label: code }))}
          />
        </div>
        <div className="min-w-28">
          <CustomSelect
            id="market-unit"
            label="計價單位"
            value={unit}
            onChange={(next) => setUnit(next as WeightUnit)}
            options={WEIGHT_UNITS.map((value) => ({
              value,
              label: `每 ${WEIGHT_UNIT_LABELS[value]}`,
            }))}
          />
        </div>
        <div role="group" aria-label="時間範圍" className="flex flex-wrap gap-1 sm:ml-auto">
          {MARKET_RANGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setRange(entry.id)}
              aria-pressed={range === entry.id}
              className={`rounded-lg px-2.5 py-1.5 text-sm font-medium ${
                range === entry.id ? 'bg-accent text-white shadow-sm' : 'interactive-muted'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <section className="surface min-w-0 rounded-xl p-4">
        {loading && <p className="py-16 text-center text-sm text-slate-500">載入中…</p>}
        {error && (
          <p role="alert" className="text-danger py-16 text-center text-sm">
            無法載入行情：{error}
          </p>
        )}
        {!loading && !error && series.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-300">這個範圍還沒有行情資料。</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              背景排程每 5 分鐘更新一次，歷史資料會在啟動時自動補齊。
            </p>
          </div>
        )}
        {!loading && !error && series.length > 0 && (
          <Suspense
            fallback={<p className="py-16 text-center text-sm text-slate-500">圖表載入中…</p>}
          >
            <MarketChart
              dark={resolvedTheme === 'dark'}
              series={series}
              markerGroups={markerGroups}
              unitLabel={WEIGHT_UNIT_LABELS[unit]}
              currency={displayCurrency}
              averageCost={averageCost}
              averageSpot={averageSpot}
              selectedPurchaseId={selectedPurchaseId}
              onSelectPurchase={setSelectedPurchaseId}
            />
          </Suspense>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          資料來源：{attribution ?? '—'}
          {lastUpdated && ` · 最後更新 ${new Date(lastUpdated).toLocaleString()}`}
          {fxRate && displayCurrency !== 'USD' && ` · 匯率 ${fxRate}`}
        </p>
      </section>

      {lines?.unavailableReason === 'MIXED_CURRENCIES' && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          這個金屬有多種幣別的買入紀錄，成本線與回本線無法以單一幣別呈現。
        </p>
      )}

      <TransactionTable
        markers={markers.data?.markers ?? []}
        unit={unit}
        displayCurrency={displayCurrency}
        fxRate={fxRate}
        selectedPurchaseId={selectedPurchaseId}
        onSelect={setSelectedPurchaseId}
      />
    </div>
  );
}

/** PRD §11.4.5 — the list below the chart, linked to the markers above it. */
function TransactionTable({
  markers,
  unit,
  displayCurrency,
  fxRate,
  selectedPurchaseId,
  onSelect,
}: {
  markers: readonly PurchaseMarker[];
  unit: WeightUnit;
  displayCurrency: string;
  fxRate: string | null;
  selectedPurchaseId: string | null;
  onSelect: (purchaseId: string | null) => void;
}) {
  if (markers.length === 0) {
    return (
      <section className="surface rounded-xl p-4">
        <h2 className="font-medium">歷史交易</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">這個金屬還沒有購買紀錄。</p>
      </section>
    );
  }

  return (
    <section className="surface min-w-0 rounded-xl p-4" aria-labelledby="market-transactions">
      <h2 id="market-transactions" className="mb-3 font-medium">
        歷史交易
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="text-left text-slate-500 dark:text-slate-400">
            <tr>
              <th scope="col" className="py-2 pr-3">
                日期
              </th>
              <th scope="col" className="px-3">
                商品
              </th>
              <th scope="col" className="px-3">
                重量
              </th>
              <th scope="col" className="px-3">
                購買總價
              </th>
              <th scope="col" className="px-3">
                每 {WEIGHT_UNIT_LABELS[unit]} 成本
              </th>
              <th scope="col" className="px-3">
                當時現貨
              </th>
              <th scope="col" className="pl-3">
                溢價率
              </th>
            </tr>
          </thead>
          <tbody>
            {markers.map((marker) => {
              const selected = marker.purchaseId === selectedPurchaseId;
              return (
                <tr
                  key={marker.purchaseId}
                  id={`purchase-row-${marker.purchaseId}`}
                  onClick={() => onSelect(selected ? null : marker.purchaseId)}
                  aria-selected={selected}
                  className={`cursor-pointer border-t border-slate-200 dark:border-slate-700 ${
                    selected ? 'bg-teal-50 dark:bg-teal-950' : ''
                  }`}
                >
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {new Date(marker.purchasedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3">{marker.names.join('、')}</td>
                  <td className="px-3 tabular-nums whitespace-nowrap">
                    {formatWeight(marker.fineWeightGrams, unit)}
                  </td>
                  <td className="px-3 tabular-nums whitespace-nowrap">
                    {formatMoney(marker.totalCost, marker.currency)}
                  </td>
                  <td className="px-3 tabular-nums whitespace-nowrap">
                    {formatUnitPrice(marker.costPerGram, marker.currency, unit)}
                  </td>
                  <td className="px-3 tabular-nums whitespace-nowrap">
                    {marker.spotPricePerGram === null
                      ? '尚無行情'
                      : formatUnitPrice(marker.spotPricePerGram, marker.currency, unit)}
                  </td>
                  <td className="pl-3 tabular-nums whitespace-nowrap">
                    {formatPremiumRate(marker.premiumRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        金額以各筆交易的原始幣別顯示（{displayCurrency}
        {fxRate ? ` 換算匯率 ${fxRate}` : ''}）。點擊一列可在上方圖表標出該筆買點。
      </p>
    </section>
  );
}

function uniqueCurrencies(...codes: string[]): string[] {
  return [...new Set(codes.map((code) => code.toUpperCase()))];
}

function formatWeight(grams: string, unit: WeightUnit): string {
  return `${fromGrams(grams, unit).toDecimalPlaces(4).toString()} ${WEIGHT_UNIT_LABELS[unit]}`;
}

/** Prices are stored per gram; the table quotes them in the selected unit. */
function formatUnitPrice(perGram: string, currency: string, unit: WeightUnit): string {
  const value = pricePerUnitFromGram(perGram, unit).toDecimalPlaces(2);
  return `${currency} ${value.toString()}`;
}
