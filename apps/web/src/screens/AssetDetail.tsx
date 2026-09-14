import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api, type AssetAttachment, type HeldAssetListItem } from '../api.js';
import { RowActionsMenu, type RowAction } from '../RowActionsMenu.js';
import { productFormLabel } from '../product-forms.js';
import { formatGrams, formatMoney } from '../units.js';
import {
  attachmentReadPath,
  documentPreview,
  isPurchaseScoped,
  previewVariant,
} from './asset-edit-model.js';

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  invoice: '發票',
  receipt: '收據',
  certificate: '證書',
  warranty_card: '保卡',
  document: '文件',
  other: '其他',
};

const PHOTO_KIND_LABELS: Record<string, string> = {
  front: '正面',
  back: '背面',
  side: '側面／幣邊',
  serial: '序號',
  security: '防偽標誌',
  packaging: '包裝',
  asset: '資產照片',
  other: '其他',
};

/**
 * One holding, in full. The list can only afford a summary row, so everything
 * a user might want to check before acting — every photo, every document, the
 * transaction it came from — lives here rather than being discoverable only by
 * opening the editor.
 */
export function AssetDetailScreen({
  asset,
  onBack,
  onEdit,
  actions,
}: {
  asset: HeldAssetListItem;
  onBack: () => void;
  onEdit: () => void;
  actions: RowAction[];
}) {
  const attachments = useQuery({
    queryKey: ['asset-attachments', asset.id],
    queryFn: () =>
      api.get<AssetAttachment[]>(`/assets/${encodeURIComponent(asset.id)}/attachments`),
  });

  const photos = (attachments.data ?? []).filter(
    (item) => item.mediaClass === 'ASSET_PHOTO' && item.status !== 'FAILED',
  );
  const documents = (attachments.data ?? []).filter(
    (item) => item.mediaClass === 'DOCUMENT' && item.status !== 'FAILED',
  );

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="interactive-muted -ml-2 rounded-lg px-2 text-sm font-medium"
          >
            ← 持有庫存
          </button>
          <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {asset.name}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {asset.metal.code} · {productFormLabel(asset.form, asset.metal.code)}
            {asset.brand ? ` · ${asset.brand}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800 dark:hover:bg-teal-600"
          >
            編輯
          </button>
          <RowActionsMenu label={`${asset.name} 的動作`} actions={actions} />
        </div>
      </div>

      <PhotoGallery
        photos={photos}
        loading={attachments.isPending}
        error={attachments.error?.message ?? null}
        assetName={asset.name}
      />

      <section className="surface rounded-xl p-4" aria-labelledby="asset-facts">
        <h2 id="asset-facts" className="font-medium">
          庫存明細
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <Fact label="數量" value={`${asset.quantity} 件`} />
          <Fact label="單件重量" value={formatGrams(asset.unitWeightGrams, 'g')} />
          <Fact label="總毛重" value={formatGrams(asset.grossWeightGrams, 'g')} />
          <Fact label="純度" value={formatPurity(asset.purity)} />
          <Fact label="細重量" value={formatGrams(asset.fineWeightGrams, 'g')} />
          <Fact label="分攤成本" value={formatMoney(asset.allocatedCost, asset.currency)} />
          <Fact label="幣別" value={asset.currency} />
          <Fact label="國家" value={asset.country ?? '—'} />
          <Fact label="年份／版本" value={asset.yearOrVersion ?? '—'} />
          <Fact label="序號" value={asset.serial ?? '—'} />
          <Fact label="存放位置" value={asset.storageLocation ?? '未設定'} />
          <Fact label="包裝狀態" value={asset.packagingState ?? '—'} />
          <Fact label="附有證書" value={asset.hasCertificate ? '是' : '否'} />
        </dl>
      </section>

      <section className="surface rounded-xl p-4" aria-labelledby="asset-transaction">
        <h2 id="asset-transaction" className="font-medium">
          交易資訊
        </h2>
        {asset.purchase ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <Fact label="交易商" value={asset.purchase.dealerName ?? '—'} />
            <Fact label="分店／櫃點" value={asset.purchase.branch ?? '—'} />
            <Fact
              label="購入日期"
              value={new Date(asset.purchase.purchasedAt).toLocaleDateString('zh-TW')}
            />
            <Fact label="訂單編號" value={asset.purchase.orderNumber ?? '—'} />
            <Fact label="發票號碼" value={asset.purchase.invoiceNumber ?? '—'} />
            <Fact label="付款方式" value={asset.purchase.paymentMethod ?? '—'} />
            {asset.purchase.notes && <Fact label="備註" value={asset.purchase.notes} wide />}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            這批庫存不是由買入建立的（例如收到的贈與），沒有交易資訊。
          </p>
        )}
      </section>

      <DocumentList
        documents={documents}
        loading={attachments.isPending}
        error={attachments.error?.message ?? null}
      />
    </div>
  );
}

function PhotoGallery({
  photos,
  loading,
  error,
  assetName,
}: {
  photos: AssetAttachment[];
  loading: boolean;
  error: string | null;
  assetName: string;
}) {
  // The cover leads, because that is the photo the list showed on the way in.
  const ordered = [...photos].sort((a, b) => Number(b.isCover) - Number(a.isCover));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = ordered.find((photo) => photo.id === selectedId) ?? ordered[0] ?? null;

  return (
    <section className="surface rounded-xl p-4" aria-labelledby="asset-photos">
      <h2 id="asset-photos" className="font-medium">
        照片
        {photos.length > 0 && (
          <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
            {photos.length} 張
          </span>
        )}
      </h2>
      {loading && <Placeholder>正在讀取照片…</Placeholder>}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-danger dark:bg-red-950"
        >
          無法讀取照片：{error}
        </p>
      )}
      {!loading && !error && photos.length === 0 && <Placeholder>尚無照片</Placeholder>}
      {selected && (
        <>
          <div className="mt-3 flex items-center justify-center rounded-xl bg-slate-100 p-2 dark:bg-slate-800">
            <AttachmentImage
              attachment={selected}
              alt={`${assetName} — ${PHOTO_KIND_LABELS[selected.kind] ?? selected.kind}`}
              className="max-h-[60vh] max-w-full rounded-lg object-contain"
            />
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {PHOTO_KIND_LABELS[selected.kind] ?? selected.kind}
            {selected.isCover ? ' · 主要照片' : ''}
            {selected.description ? ` · ${selected.description}` : ''}
          </p>
        </>
      )}
      {ordered.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {ordered.map((photo) => (
            <li key={photo.id}>
              <button
                type="button"
                aria-pressed={photo.id === selected?.id}
                onClick={() => setSelectedId(photo.id)}
                className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${
                  photo.id === selected?.id
                    ? 'border-accent'
                    : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <AttachmentImage
                  attachment={photo}
                  alt={PHOTO_KIND_LABELS[photo.kind] ?? photo.kind}
                  className="h-full w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DocumentList({
  documents,
  loading,
  error,
}: {
  documents: AssetAttachment[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="surface rounded-xl p-4" aria-labelledby="asset-documents">
      <h2 id="asset-documents" className="font-medium">
        文件
        {documents.length > 0 && (
          <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
            {documents.length} 份
          </span>
        )}
      </h2>
      {loading && <Placeholder>正在讀取文件…</Placeholder>}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-danger dark:bg-red-950"
        >
          無法讀取文件：{error}
        </p>
      )}
      {!loading && !error && documents.length === 0 && <Placeholder>尚無文件</Placeholder>}
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="min-w-0 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
          >
            <div className="flex min-h-32 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
              {documentPreview(doc.mime) === 'image' ? (
                <AttachmentImage
                  attachment={doc}
                  alt={doc.filename}
                  className="max-h-48 max-w-full rounded object-contain"
                />
              ) : (
                <AttachmentOpenLink attachment={doc} />
              )}
            </div>
            <div className="mt-2 flex min-w-0 items-start gap-2">
              <p className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">
                {doc.filename}
              </p>
              <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {isPurchaseScoped(doc) ? '整筆交易' : '本批次'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {DOCUMENT_KIND_LABELS[doc.kind] ?? doc.kind}
              {doc.description ? ` · ${doc.description}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Private storage is only reachable through a short-lived signed URL, so every
 * image has to fetch its own before it can render.
 */
function useAttachmentUrl(attachment: AssetAttachment) {
  const variant = previewVariant(attachment);
  return useQuery({
    queryKey: [
      'attachment-read-url',
      attachment.id,
      variant?.kind ?? null,
      variant?.revision ?? null,
      'inline',
    ],
    queryFn: () => api.get<{ url: string }>(attachmentReadPath(attachment.id, variant, 'inline')),
    staleTime: 20_000,
    retry: 1,
  });
}

function AttachmentImage({
  attachment,
  alt,
  className,
}: {
  attachment: AssetAttachment;
  alt: string;
  className: string;
}) {
  const signedUrl = useAttachmentUrl(attachment);
  if (signedUrl.isPending) {
    return <div className="h-32 w-full animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />;
  }
  if (!signedUrl.data?.url) {
    return (
      <button
        type="button"
        className="px-3 text-xs font-medium text-accent underline-offset-2 hover:underline dark:text-teal-400"
        onClick={() => void signedUrl.refetch()}
      >
        載入失敗，重試
      </button>
    );
  }
  return (
    <img src={signedUrl.data.url} alt={alt} className={className} loading="lazy" decoding="async" />
  );
}

function AttachmentOpenLink({ attachment }: { attachment: AssetAttachment }) {
  const signedUrl = useAttachmentUrl(attachment);
  if (!signedUrl.data?.url) {
    return <span className="text-xs text-slate-500 dark:text-slate-400">準備中…</span>;
  }
  return (
    <a
      href={signedUrl.data.url}
      target="_blank"
      rel="noreferrer"
      className="px-3 text-sm font-medium text-accent underline-offset-2 hover:underline dark:text-teal-400"
    >
      開啟 {attachment.mime === 'application/pdf' ? 'PDF' : '檔案'}
    </a>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
      {children}
    </p>
  );
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0 sm:col-span-3' : 'min-w-0'}>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="break-words font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function formatPurity(purity: string): string {
  const ratio = Number(purity);
  if (!Number.isFinite(ratio)) return '—';
  return `${Number((ratio * 100).toFixed(5))}%`;
}
