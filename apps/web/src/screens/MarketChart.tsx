import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef } from 'react';

import { formatPremiumRate, type PurchaseMarker } from './market-model.js';

// Registering only what is drawn keeps the bundle far below a full ECharts import.
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export interface MarkerGroup {
  value: [number, number];
  markers: PurchaseMarker[];
}

interface MarketChartProps {
  dark: boolean;
  series: [number, number][];
  markerGroups: MarkerGroup[];
  unitLabel: string;
  currency: string;
  averageCost: number | null;
  averageSpot: number | null;
  selectedPurchaseId: string | null;
  onSelectPurchase: (purchaseId: string | null) => void;
}

/** Pixel radius within which a click counts as hitting a purchase line. */
const CLICK_TOLERANCE_PX = 14;

/**
 * Price line with buy-point overlay (PRD §11.4.2–§11.4.4).
 *
 * Purchases are drawn as full-height vertical lines rather than points. A point
 * has to sit at *some* price, which invites reading it as a price it does not
 * mean — a purchase below melt lands near the floor of the chart and looks like
 * a data error. A vertical line says only "you bought on this day", which is
 * what the mark is actually for; the price paid belongs in the tooltip.
 *
 * The instance is driven imperatively through a ref: rebuilding it on every
 * render would discard the user's zoom and pan.
 */
export function MarketChart({
  dark,
  series,
  markerGroups,
  unitLabel,
  currency,
  averageCost,
  averageSpot,
  selectedPurchaseId,
  onSelectPurchase,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Read inside event handlers, which are bound once and must not capture stale
  // props from the render that installed them.
  const groupsRef = useRef(markerGroups);
  groupsRef.current = markerGroups;
  const selectRef = useRef(onSelectPurchase);
  selectRef.current = onSelectPurchase;

  /** Purchases indexed by UTC day, so the axis tooltip can find same-day buys. */
  const byDay = useMemo(() => {
    const index = new Map<string, PurchaseMarker[]>();
    for (const group of markerGroups) {
      for (const marker of group.markers) {
        const key = marker.purchasedAt.slice(0, 10);
        index.set(key, [...(index.get(key) ?? []), marker]);
      }
    }
    return index;
  }, [markerGroups]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);

    // Selecting a purchase from the chart: markLine is not clickable, so the
    // nearest vertical line to the pointer is resolved from raw canvas
    // coordinates instead.
    const zr = chart.getZr();
    const onClick = (event: { offsetX: number; offsetY: number }) => {
      const point = chart.convertFromPixel({ seriesId: 'spot' }, [event.offsetX, event.offsetY]);
      const clickedAt = Array.isArray(point) ? Number(point[0]) : Number.NaN;
      if (!Number.isFinite(clickedAt)) return;

      let nearest: { marker: PurchaseMarker; distance: number } | null = null;
      for (const group of groupsRef.current) {
        const pixel = chart.convertToPixel({ seriesId: 'spot' }, [group.value[0], 0]);
        const x = Array.isArray(pixel) ? Number(pixel[0]) : Number.NaN;
        if (!Number.isFinite(x)) continue;
        const distance = Math.abs(x - event.offsetX);
        const first = group.markers[0];
        if (first && (!nearest || distance < nearest.distance))
          nearest = { marker: first, distance };
      }

      if (!nearest || nearest.distance > CLICK_TOLERANCE_PX) return;
      selectRef.current(nearest.marker.purchaseId);
      document
        .getElementById(`purchase-row-${nearest.marker.purchaseId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    zr.on('click', onClick);

    return () => {
      zr.off('click', onClick);
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const axisColor = dark ? '#94a3b8' : '#475569';
    const splitColor = dark ? '#1e293b' : '#e2e8f0';
    const surface = dark ? '#0f172a' : '#ffffff';
    const ink = dark ? '#e2e8f0' : '#0f172a';

    const markLines: Record<string, unknown>[] = [];

    // Horizontal reference lines (PRD §11.4.4).
    if (averageSpot !== null) {
      markLines.push({
        yAxis: averageSpot,
        lineStyle: { color: '#64748b', type: 'dotted', width: 1.5 },
        label: {
          formatter: `買入時平均現貨 ${round(averageSpot)}`,
          position: 'insideStartTop',
          color: axisColor,
          fontSize: 11,
        },
      });
    }
    if (averageCost !== null) {
      markLines.push({
        yAxis: averageCost,
        lineStyle: { color: '#f59e0b', type: 'dashed', width: 1.5 },
        label: {
          formatter: `平均成本／回本線 ${round(averageCost)}`,
          position: 'insideEndTop',
          color: '#f59e0b',
          fontSize: 11,
        },
      });
    }

    // Vertical purchase lines.
    for (const group of markerGroups) {
      const selected = group.markers.some((m) => m.purchaseId === selectedPurchaseId);
      markLines.push({
        xAxis: group.value[0],
        lineStyle: {
          color: selected ? '#f97316' : '#e11d48',
          type: selected ? 'solid' : 'dashed',
          width: selected ? 2.5 : 1.5,
          opacity: selected ? 1 : 0.75,
        },
        label: {
          formatter: group.markers.length > 1 ? `買入 ×${group.markers.length}` : '買入',
          position: 'start',
          color: selected ? '#f97316' : '#e11d48',
          fontSize: 11,
          fontWeight: selected ? 'bold' : 'normal',
          backgroundColor: surface,
          padding: [2, 4],
          borderRadius: 3,
        },
      });
    }

    chart.setOption(
      {
        animation: false,
        backgroundColor: 'transparent',
        grid: { left: 8, right: 20, top: 28, bottom: 60, containLabel: true },
        // `axis` trigger with a crosshair reports the price at wherever the
        // pointer is, instead of requiring an exact hit on a data point.
        tooltip: {
          trigger: 'axis',
          confine: true,
          backgroundColor: surface,
          borderColor: splitColor,
          borderWidth: 1,
          padding: 10,
          textStyle: { color: ink, fontSize: 12 },
          axisPointer: {
            type: 'cross',
            snap: true,
            lineStyle: { color: axisColor, type: 'dashed', width: 1 },
            crossStyle: { color: axisColor },
            label: { backgroundColor: dark ? '#334155' : '#475569' },
          },
          formatter: (params: unknown) =>
            axisTooltipHtml(params, unitLabel, currency, byDay, surface),
        },
        xAxis: {
          type: 'time',
          boundaryGap: false,
          axisLine: { lineStyle: { color: splitColor } },
          axisTick: { show: false },
          axisLabel: { color: axisColor, hideOverlap: true },
        },
        yAxis: {
          type: 'value',
          scale: true,
          name: `${currency} / ${unitLabel}`,
          nameGap: 14,
          nameTextStyle: { color: axisColor, align: 'left', fontSize: 11 },
          axisLabel: { color: axisColor, formatter: (value: number) => round(value) },
          splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
        },
        dataZoom: [
          // Explicit bounds so switching the time range always resets the
          // window rather than keeping a stale zoom from the previous range.
          { type: 'inside', throttle: 50, start: 0, end: 100 },
          {
            type: 'slider',
            height: 22,
            bottom: 14,
            start: 0,
            end: 100,
            borderColor: splitColor,
            fillerColor: dark ? 'rgba(13,148,136,0.18)' : 'rgba(13,148,136,0.12)',
            handleStyle: { color: '#0d9488' },
            textStyle: { color: axisColor, fontSize: 10 },
          },
        ],
        series: [
          {
            id: 'spot',
            name: '現貨價',
            type: 'line',
            data: series,
            showSymbol: false,
            symbol: 'circle',
            symbolSize: 6,
            smooth: 0.2,
            sampling: 'lttb',
            lineStyle: { width: 2, color: '#0d9488' },
            itemStyle: { color: '#0d9488', borderColor: surface, borderWidth: 2 },
            emphasis: { focus: 'series', scale: 1.4 },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: dark ? 'rgba(13,148,136,0.30)' : 'rgba(13,148,136,0.22)' },
                  { offset: 1, color: 'rgba(13,148,136,0)' },
                ],
              },
            },
            markLine: markLines.length
              ? { symbol: 'none', silent: true, animation: false, data: markLines }
              : undefined,
          },
        ],
      },
      // Replace wholesale so a range change cannot leave stale marks behind.
      true,
    );
  }, [
    dark,
    series,
    markerGroups,
    unitLabel,
    currency,
    averageCost,
    averageSpot,
    selectedPurchaseId,
    byDay,
  ]);

  return (
    <div
      ref={containerRef}
      className="h-[22rem] w-full sm:h-[28rem]"
      role="img"
      aria-label="歷史現貨價格與買點圖"
    />
  );
}

function round(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Axis tooltip: always the spot price under the pointer, plus the full purchase
 * detail PRD §11.4.3 requires whenever a buy falls on that day.
 */
function axisTooltipHtml(
  params: unknown,
  unitLabel: string,
  currency: string,
  byDay: Map<string, PurchaseMarker[]>,
  surface: string,
): string {
  const entries = Array.isArray(params) ? params : [params];
  const first = entries[0] as { value?: [number, number] } | undefined;
  if (!first?.value) return '';

  const at = new Date(first.value[0]);
  const price = first.value[1];
  const head = `
    <div style="font-weight:600">${escapeHtml(at.toLocaleDateString())}</div>
    <div style="margin-top:2px">現貨 <b>${round(price)}</b> ${escapeHtml(currency)}/${escapeHtml(unitLabel)}</div>`;

  const purchases = byDay.get(at.toISOString().slice(0, 10)) ?? [];
  if (purchases.length === 0) return head;

  const rows = purchases
    .map(
      (marker) => `
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.35)">
        <div style="color:#e11d48;font-weight:600">買入 · ${escapeHtml(marker.names.join('、'))}</div>
        <div>數量 ${marker.quantity} · 純重 ${escapeHtml(trim(marker.fineWeightGrams))} g</div>
        <div>總價 ${escapeHtml(marker.currency)} ${escapeHtml(trim(marker.totalCost))}</div>
        <div>每公克成本 ${escapeHtml(trim(marker.costPerGram))}</div>
        <div>當時現貨 ${escapeHtml(marker.spotPricePerGram ? trim(marker.spotPricePerGram) : '尚無行情')}</div>
        <div>溢價率 <b>${escapeHtml(formatPremiumRate(marker.premiumRate))}</b></div>
      </div>`,
    )
    .join('');

  return `<div style="background:${surface}">${head}${rows}</div>`;
}

/** Trims stored decimal tails so a tooltip stays readable. */
function trim(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? round(parsed) : value;
}

/** Marker text is user-supplied product data going into an HTML tooltip. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
