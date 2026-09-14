/**
 * Sub-navigation inside 持有庫存: the list, one holding's detail page, and the
 * full-screen editor. All three live in the URL so the browser's back button,
 * a reload, and a shared link all land where the user expects.
 */

export const ASSET_PARAM = 'asset';
export const ASSET_STEP_PARAM = 'assetStep';

export const ASSET_EDIT_STEPS = [
  { id: 'transaction', label: '交易資訊' },
  { id: 'description', label: '商品描述' },
  { id: 'spec', label: '規格' },
  { id: 'cost', label: '成本與幣別' },
  { id: 'custody', label: '保管與證書' },
  { id: 'photos', label: '照片' },
  { id: 'documents', label: '文件' },
  { id: 'review', label: '確認儲存' },
] as const;

export type AssetEditStep = (typeof ASSET_EDIT_STEPS)[number]['id'];

export const FIRST_ASSET_EDIT_STEP: AssetEditStep = ASSET_EDIT_STEPS[0].id;

export function isAssetEditStep(value: unknown): value is AssetEditStep {
  return (
    typeof value === 'string' && ASSET_EDIT_STEPS.some((step) => (step.id as string) === value)
  );
}

export function assetEditStepLabel(step: AssetEditStep): string {
  return ASSET_EDIT_STEPS.find((entry) => entry.id === step)?.label ?? '';
}

export function assetEditStepIndex(step: AssetEditStep): number {
  return ASSET_EDIT_STEPS.findIndex((entry) => entry.id === step);
}

export function nextAssetEditStep(step: AssetEditStep): AssetEditStep | null {
  return ASSET_EDIT_STEPS[assetEditStepIndex(step) + 1]?.id ?? null;
}

export function previousAssetEditStep(step: AssetEditStep): AssetEditStep | null {
  const index = assetEditStepIndex(step);
  return index <= 0 ? null : (ASSET_EDIT_STEPS[index - 1]?.id ?? null);
}

export type InventoryView =
  | { kind: 'list' }
  | { kind: 'detail'; assetId: string }
  | { kind: 'edit'; assetId: string; step: AssetEditStep };

export function readInventoryView(search: string): InventoryView {
  const params = new URLSearchParams(search);
  const assetId = params.get(ASSET_PARAM)?.trim();
  if (!assetId) return { kind: 'list' };
  const step = params.get(ASSET_STEP_PARAM);
  if (step === null) return { kind: 'detail', assetId };
  // An unrecognised step is a stale or hand-edited link. Opening the editor at
  // its first step beats dropping the user back on the list with no
  // explanation, and beats trusting the value.
  return { kind: 'edit', assetId, step: isAssetEditStep(step) ? step : FIRST_ASSET_EDIT_STEP };
}

export function urlForInventoryView(href: string, view: InventoryView): string {
  const url = new URL(href, 'http://localhost');
  if (view.kind === 'list') {
    url.searchParams.delete(ASSET_PARAM);
    url.searchParams.delete(ASSET_STEP_PARAM);
  } else {
    url.searchParams.set(ASSET_PARAM, view.assetId);
    if (view.kind === 'edit') url.searchParams.set(ASSET_STEP_PARAM, view.step);
    else url.searchParams.delete(ASSET_STEP_PARAM);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function sameInventoryView(a: InventoryView, b: InventoryView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'list' || b.kind === 'list') return true;
  if (a.assetId !== b.assetId) return false;
  return a.kind !== 'edit' || b.kind !== 'edit' || a.step === b.step;
}
