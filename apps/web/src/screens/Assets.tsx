import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { api, type HeldAssetListItem } from '../api.js';
import { CustomSelect } from '../CustomSelect.js';
import { productFormLabel } from '../product-forms.js';
import { formatGrams, formatMoney } from '../units.js';
import { AssetDisposalDialog, type DisposalAction } from './AssetDisposalDialog.js';
import { AssetEditWizard } from './AssetEditWizard.js';
import { RowActionsMenu, type RowAction } from '../RowActionsMenu.js';
import { assetPhotoReadPath, filterHeldAssets, heldUnitCount } from './assets-model.js';

export function AssetsScreen({ onAddPurchase }: { onAddPurchase: () => void }) {
  const assets = useQuery<HeldAssetListItem[]>({
    queryKey: ['assets'],
    queryFn: () => api.get<HeldAssetListItem[]>('/assets'),
  });
  const [query, setQuery] = useState('');
  const [metalCode, setMetalCode] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const allAssets = assets.data ?? [];
  const metalOptions = useMemo(
    () =>
      [...new Map(allAssets.map((asset) => [asset.metal.code, asset.metal])).values()].sort(
        (a, b) => a.code.localeCompare(b.code),
      ),
    [allAssets],
  );
  const visibleAssets = useMemo(
    () => filterHeldAssets(allAssets, { query, metalCode }),
    [allAssets, metalCode, query],
  );

  if (assets.isPending) return <PageState message="正在讀取持有庫存…" />;
  if (assets.isError) {
    return (
      <PageState
        message={`無法讀取庫存：${assets.error.message}`}
        retry={() => void assets.refetch()}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">持有庫存</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            一個批次代表一次入庫品項；件數則是該批次目前持有的實際數量。
          </p>
        </div>
        <button
          type="button"
          onClick={onAddPurchase}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800 dark:hover:bg-teal-600"
        >
          新增入庫
        </button>
      </div>

      {allAssets.length === 0 ? (
        <section className="surface rounded-xl px-4 py-10 text-center">
          <h2 className="font-semibold">目前尚無持有庫存</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            完成第一筆入庫後，商品批次、重量與成本會顯示在這裡。
          </p>
          <button
            type="button"
            onClick={onAddPurchase}
            className="mt-4 rounded-lg bg-accent px-5 py-2 font-medium text-white"
          >
            開始新增入庫
          </button>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <SummaryCard label="持有批次" value={`${allAssets.length} 批`} />
            <SummaryCard label="持有件數" value={`${heldUnitCount(allAssets)} 件`} />
          </div>

          <section className="surface grid gap-3 rounded-xl p-3 sm:grid-cols-[minmax(0,1fr)_13rem] sm:p-4">
            <label className="block text-sm">
              <span className="sr-only">搜尋庫存</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋商品、品牌、序號或存放位置"
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
            <CustomSelect
              label="依金屬篩選"
              hideLabel
              value={metalCode}
              onChange={setMetalCode}
              options={[
                { value: '', label: '全部金屬' },
                ...metalOptions.map((metal) => ({
                  value: metal.code,
                  label: `${metal.code} — ${metal.name}`,
                })),
              ]}
            />
          </section>

          <InventoryList
            assets={visibleAssets}
            allAssets={allAssets}
            editingId={editingId}
            onEdit={(id) => setEditingId(id)}
            isPending={false}
          />

          {visibleAssets.length === 0 && (
            <section className="surface rounded-xl px-4 py-8 text-center">
              <p className="font-medium">找不到符合條件的庫存</p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setMetalCode('');
                }}
                className="mt-2 rounded-lg px-4 font-medium text-accent underline-offset-4 hover:underline dark:text-teal-400"
              >
                清除篩選
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function InventoryList({
  assets,
  allAssets,
  editingId,
  onEdit,
  isPending,
}: {
  assets: readonly HeldAssetListItem[];
  allAssets: readonly HeldAssetListItem[];
  editingId: string | null;
  onEdit: (id: string | null) => void;
  isPending?: boolean;
}) {
  const editingAsset = allAssets.find((asset) => asset.id === editingId);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [disposal, setDisposal] = useState<{ action: DisposalAction; assetId: string } | null>(
    null,
  );
  const disposalAsset = allAssets.find((asset) => asset.id === disposal?.assetId);
  const actionsDisabled = Boolean(isPending || editingId || disposal);

  useEffect(() => {
    if (editingId !== null && !editingAsset) onEdit(null);
  }, [editingAsset, editingId, onEdit]);

  return (
    <section aria-label="持有庫存清單" className="min-w-0 space-y-3">
      {disposal && disposalAsset && (
        <AssetDisposalDialog
          action={disposal.action}
          target={{
            id: disposalAsset.id,
            name: disposalAsset.name,
            quantity: disposalAsset.quantity,
            allocatedCost: disposalAsset.allocatedCost,
            currency: disposalAsset.currency,
            version: disposalAsset.version,
          }}
          onClose={() => setDisposal(null)}
        />
      )}
      {editingAsset && (
        <div className="surface rounded-xl p-4">
          <AssetEditWizard
            asset={editingAsset}
            onDone={() => onEdit(null)}
            onCancel={() => onEdit(null)}
          />
        </div>
      )}

      {!isDesktop && assets.length > 0 && (
        <div className="space-y-3">
          {assets
            .filter((asset) => asset.id !== editingId)
            .map((asset) => (
              <MobileAssetCard
                key={asset.id}
                asset={asset}
                actions={assetActions(asset, onEdit, setDisposal, actionsDisabled)}
              />
            ))}
        </div>
      )}

      {isDesktop && assets.length > 0 && (
        <div className="surface rounded-xl">
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th scope="col" className="w-[28%] p-3">
                  商品批次
                </th>
                <th scope="col" className="w-[12%] p-3">
                  金屬／形式
                </th>
                <th scope="col" className="w-[20%] p-3">
                  持有量
                </th>
                <th scope="col" className="w-[16%] p-3 text-right">
                  分攤成本
                </th>
                <th scope="col" className="w-[16%] p-3">
                  購入／存放
                </th>
                <th scope="col" className="w-[8%] p-3 text-right">
                  <span className="sr-only">動作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr
                  key={asset.id}
                  className="border-t border-slate-200 align-middle dark:border-slate-700"
                >
                  <td className="break-words p-3 [overflow-wrap:anywhere]">
                    <div className="flex min-w-0 items-center gap-3">
                      <AssetThumbnail asset={asset} size="desktop" />
                      <div className="min-w-0">
                        <div className="font-medium">{asset.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {asset.brand || '未設定品牌'}
                          {asset.serial ? ` · ${asset.serial}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="inline-block rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                      {asset.metal.code}
                    </span>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {productFormLabel(asset.form, asset.metal.code)}
                    </div>
                  </td>
                  {/* Quantity, weight and purity read as one fact about the lot,
                      so they share a cell instead of three sparse columns. */}
                  <td className="p-3">
                    <div className="tabular-nums">
                      {asset.quantity} 件 · {formatGrams(asset.grossWeightGrams, 'g')}
                    </div>
                    <div className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      純度 {formatPurity(asset.purity)} · 細重{' '}
                      {formatGrams(asset.fineWeightGrams, 'g')}
                    </div>
                  </td>
                  <td className="break-words p-3 text-right tabular-nums [overflow-wrap:anywhere]">
                    {formatMoney(asset.allocatedCost, asset.currency)}
                  </td>
                  <td className="break-words p-3 [overflow-wrap:anywhere]">
                    <div>{formatPurchaseDate(asset)}</div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {asset.storageLocation || '未設定存放位置'}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    <RowActionsMenu
                      label={`${asset.name} 的動作`}
                      actions={assetActions(asset, onEdit, setDisposal, actionsDisabled)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * The action list for one holding. Shared by the desktop table and the mobile
 * card so an action can never exist in only one of the two layouts.
 */
function assetActions(
  asset: HeldAssetListItem,
  onEdit: (id: string) => void,
  onDispose: (disposal: { action: DisposalAction; assetId: string }) => void,
  disabled = false,
): RowAction[] {
  return [
    { id: 'edit', label: '編輯', onSelect: () => onEdit(asset.id), disabled },
    {
      id: 'sell',
      label: '售出',
      onSelect: () => onDispose({ action: 'SALE', assetId: asset.id }),
      disabled,
    },
    {
      id: 'gift',
      label: '贈與他人',
      onSelect: () => onDispose({ action: 'GIFT_OUT', assetId: asset.id }),
      disabled,
    },
    {
      id: 'lost',
      label: '標記遺失',
      tone: 'danger',
      onSelect: () => onDispose({ action: 'LOST', assetId: asset.id }),
      disabled,
    },
  ];
}

function AssetHeading({ asset, actions }: { asset: HeldAssetListItem; actions?: RowAction[] }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="break-words font-semibold [overflow-wrap:anywhere]">{asset.name}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {asset.purchase?.dealerName || '未設定交易商'}
        </p>
      </div>
      <div className="flex shrink-0 items-start gap-2">
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-300">
            {asset.metal.code}
          </span>
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">持有中</span>
        </div>
        {actions && <RowActionsMenu label={`${asset.name} 的動作`} actions={actions} />}
      </div>
    </div>
  );
}

function MobileAssetCard({ asset, actions }: { asset: HeldAssetListItem; actions: RowAction[] }) {
  return (
    <article className="surface rounded-xl p-4">
      <div className="flex min-w-0 items-start gap-3">
        <AssetThumbnail asset={asset} size="mobile" />
        <div className="min-w-0 flex-1">
          <AssetHeading asset={asset} actions={actions} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Metric label="形式" value={productFormLabel(asset.form, asset.metal.code)} />
        <Metric label="品牌" value={asset.brand ?? '—'} />
        <Metric label="數量" value={`${asset.quantity} 件`} />
        <Metric label="單件重量" value={formatGrams(asset.unitWeightGrams, 'g')} />
        <Metric label="總毛重" value={formatGrams(asset.grossWeightGrams, 'g')} />
        <Metric label="細重量" value={formatGrams(asset.fineWeightGrams, 'g')} />
        <Metric label="純度" value={formatPurity(asset.purity)} />
        <Metric label="分攤成本" value={formatMoney(asset.allocatedCost, asset.currency)} />
        <Metric label="購入日期" value={formatPurchaseDate(asset)} />
        <Metric label="存放位置" value={asset.storageLocation ?? '未設定'} />
        {asset.serial && <Metric label="序號" value={asset.serial} wide />}
        {(asset.packagingState || asset.hasCertificate) && (
          <Metric
            label="隨附資訊"
            value={
              [asset.packagingState, asset.hasCertificate ? '有證書' : null]
                .filter(Boolean)
                .join(' · ') || '—'
            }
            wide
          />
        )}
      </dl>
    </article>
  );
}

type AttachmentReadUrl = {
  url: string;
  expiresInSeconds: number;
  attachmentId: string;
  variant: string;
  revision: number;
};

function AssetThumbnail({ asset, size }: { asset: HeldAssetListItem; size: 'mobile' | 'desktop' }) {
  const photo = asset.coverPhoto;
  const signedUrl = useQuery<AttachmentReadUrl>({
    queryKey: [
      'attachment-read-url',
      photo?.attachmentId ?? null,
      photo?.variant ?? null,
      photo?.revision ?? null,
    ],
    queryFn: () => api.get<AttachmentReadUrl>(assetPhotoReadPath(photo!)),
    enabled: photo !== null,
    staleTime: 20_000,
    retry: 1,
  });
  const [imageFailed, setImageFailed] = useState(false);
  const dimensions = size === 'mobile' ? 'h-24 w-24' : 'h-16 w-16';

  useEffect(() => {
    setImageFailed(false);
  }, [photo?.attachmentId, photo?.revision, photo?.variant, signedUrl.data?.url]);

  if (!photo) {
    return (
      <PhotoPlaceholder
        dimensions={dimensions}
        label={`${asset.name} 尚無資產照片`}
        message="尚無照片"
      />
    );
  }

  if (signedUrl.isError || imageFailed) {
    return (
      <button
        type="button"
        className={`${dimensions} group flex min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-1 text-center text-[10px] text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700`}
        aria-label={`重新載入 ${asset.name} 的資產照片`}
        aria-busy={signedUrl.isFetching}
        disabled={signedUrl.isFetching}
        onClick={() => {
          void signedUrl.refetch().then((result) => {
            if (result.isSuccess) setImageFailed(false);
          });
        }}
      >
        <span>照片無法載入</span>
        <span
          aria-live="polite"
          className="mt-0.5 font-medium text-accent underline-offset-2 group-hover:underline dark:text-teal-300"
        >
          {signedUrl.isFetching ? '重新載入中…' : '重試'}
        </span>
      </button>
    );
  }

  if (!signedUrl.data) {
    return (
      <div
        className={`${dimensions} shrink-0 animate-pulse rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800`}
        role="status"
        aria-label={`正在載入 ${asset.name} 的資產照片`}
      />
    );
  }

  return (
    <div
      className={`${dimensions} shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800`}
    >
      <img
        src={signedUrl.data.url}
        alt={`${asset.name} 資產照片`}
        className="h-full w-full object-contain"
        loading="lazy"
        decoding="async"
        onError={() => setImageFailed(true)}
      />
    </div>
  );
}

function PhotoPlaceholder({
  dimensions,
  label,
  message,
}: {
  dimensions: string;
  label: string;
  message: string;
}) {
  return (
    <div
      className={`${dimensions} flex shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-1 text-center text-[10px] text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300`}
      role="img"
      aria-label={label}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="mb-1 h-5 w-5" fill="none">
        <path
          d="M4 7.5h3l1.2-2h7.6l1.2 2h3v11H4v-11Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="13" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

function Metric({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="break-words font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface rounded-xl p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function formatPurity(purity: string): string {
  const ratio = Number(purity);
  if (!Number.isFinite(ratio)) return '—';
  return `${Number((ratio * 100).toFixed(5))}%`;
}

function formatPurchaseDate(asset: HeldAssetListItem): string {
  const date = new Date(asset.purchase?.purchasedAt ?? asset.acquiredAt);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleDateString('zh-TW');
}

function PageState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="py-10 text-center">
      <p className="text-slate-600 dark:text-slate-300">{message}</p>
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="mt-2 rounded-lg px-4 font-medium text-accent underline-offset-4 hover:underline dark:text-teal-400"
        >
          重試
        </button>
      )}
    </div>
  );
}
