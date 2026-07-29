import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { api, type AssetAttachment, type HeldAssetListItem } from '../api.js';
import { createWizardMedia } from '../purchase-wizard/media-utils.js';
import { renderCroppedPhoto, renderDocumentScan } from '../purchase-wizard/index.js';
import { formatGrams, formatMoney } from '../units.js';
import { formatWeightInput } from '@bullion-ledger/shared';
import Decimal from 'decimal.js';

type EditStepId = 'transaction' | 'details' | 'costs' | 'photos' | 'documents' | 'review';

interface EditStepDef {
  id: EditStepId;
  label: string;
  shortLabel: string;
}

const EDIT_STEPS: EditStepDef[] = [
  { id: 'transaction', label: '交易資訊', shortLabel: '交易' },
  { id: 'details', label: '商品資訊', shortLabel: '商品' },
  { id: 'costs', label: '成本', shortLabel: '成本' },
  { id: 'photos', label: '照片管理', shortLabel: '照片' },
  { id: 'documents', label: '文件', shortLabel: '文件' },
  { id: 'review', label: '確認儲存', shortLabel: '確認' },
];

interface EditPhoto {
  id: string;
  serverId?: string;
  serverVersion?: number;
  kind: string;
  isCover: boolean;
  description: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  source: 'CAMERA' | 'LIBRARY';
  originalFile?: File;
  previewUrl?: string;
  crop?: { x: number; y: number; width: number; height: number };
  width?: number;
  height?: number;
  needsReselection?: boolean;
  deleted?: boolean;
  variantKind?: string;
  variantRevision?: number;
}

interface EditDocument {
  id: string;
  serverId?: string;
  serverVersion?: number;
  documentType: string;
  description: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  source: 'CAMERA' | 'LIBRARY';
  originalFile?: File;
  previewUrl?: string;
  corners?: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } };
  width?: number;
  height?: number;
  needsReselection?: boolean;
  deleted?: boolean;
}

interface AssetEditWizardProps {
  asset: HeldAssetListItem;
  onDone: () => void;
  onCancel: () => void;
}

export function AssetEditWizard({ asset, onDone, onCancel }: AssetEditWizardProps) {
  const [step, setStep] = useState<EditStepId>('transaction');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Basic info form
  const [name, setName] = useState(asset.name ?? '');
  const [serial, setSerial] = useState(asset.serial ?? '');
  const [storageLocation, setStorageLocation] = useState(asset.storageLocation ?? '');
  const [brand, setBrand] = useState(asset.brand ?? '');
  const [country, setCountry] = useState(asset.country ?? '');
  const [yearOrVersion, setYearOrVersion] = useState(asset.yearOrVersion ?? '');
  const [packagingState, setPackagingState] = useState(asset.packagingState ?? '');
  const [hasCertificate, setHasCertificate] = useState(asset.hasCertificate);
  const [quantity, setQuantity] = useState(String(asset.quantity));
  const [unitWeight, setUnitWeight] = useState(formatWeightInput(asset.unitWeightGrams));
  const [purity, setPurity] = useState(asset.purity);
  const [allocatedCost, setAllocatedCost] = useState(asset.allocatedCost);

  // Photos
  const originalCoverId = useRef(
    asset.photos?.find((p) => p.isCover)?.id ?? asset.photos?.[0]?.id ?? null,
  );
  const [photos, setPhotos] = useState<EditPhoto[]>(() =>
    (asset.photos ?? []).map((p, i) => ({
      id: p.id,
      serverId: p.id,
      kind: p.kind,
      isCover: p.isCover || (i === 0 && !asset.photos?.some((x) => x.isCover)),
      description: p.description ?? '',
      filename: p.filename,
      mime: p.mime,
      sizeBytes: 0,
      source: 'LIBRARY' as const,
      variantKind: p.variant?.variant,
      variantRevision: p.variant?.revision,
    })),
  );
  const [newPhotoMedia, setNewPhotoMedia] = useState<EditPhoto[]>([]);
  const deletedPhotoIds = useRef(new Set<string>());

  // Documents
  const [documents, setDocuments] = useState<EditDocument[]>([]);
  const [newDocs, setNewDocs] = useState<EditDocument[]>([]);
  const deletedDocIds = useRef(new Set<string>());

  const stepIndex = EDIT_STEPS.findIndex((s) => s.id === step);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = { version: asset.version };

      const qty = parseInt(quantity, 10);
      if (qty !== asset.quantity) patch.quantity = qty;

      const nw = formatWeightInput(unitWeight);
      if (nw !== formatWeightInput(asset.unitWeightGrams)) {
        patch.unitWeight = nw;
        patch.weightUnit = 'g';
      }

      const cp = new Decimal(purity).toFixed();
      if (cp !== asset.purity) patch.purity = cp;

      const nc = new Decimal(allocatedCost.trim()).toFixed();
      if (nc !== asset.allocatedCost) patch.allocatedCost = nc;

      if (serial.trim() !== (asset.serial ?? '')) patch.serial = serial.trim() || null;
      if (storageLocation.trim() !== (asset.storageLocation ?? ''))
        patch.storageLocation = storageLocation.trim() || null;
      if (name.trim() !== (asset.name ?? '')) patch.name = name.trim() || null;
      if (brand.trim() !== (asset.brand ?? '')) patch.brand = brand.trim() || null;
      if (country.trim() !== (asset.country ?? '')) patch.country = country.trim() || null;
      if (yearOrVersion.trim() !== (asset.yearOrVersion ?? ''))
        patch.yearOrVersion = yearOrVersion.trim() || null;
      if (packagingState.trim() !== (asset.packagingState ?? ''))
        patch.packagingState = packagingState.trim() || null;
      if (hasCertificate !== asset.hasCertificate) patch.hasCertificate = hasCertificate;

      // Delete removed photos
      for (const id of deletedPhotoIds.current) {
        await api.delete(`/attachments/${encodeURIComponent(id)}`);
      }

      // Delete removed documents (purchase-level)
      for (const id of deletedDocIds.current) {
        await api.delete(`/attachments/${encodeURIComponent(id)}`);
      }

      // Set cover photo (skip if unchanged to avoid version mismatch)
      const activePhotos = photos.filter((p) => !p.deleted);
      const coverPhoto = activePhotos.find((p) => p.isCover);
      const newCoverId = coverPhoto?.serverId ?? null;
      if (newCoverId !== originalCoverId.current) {
        const fetchVersion = async (id: string) => {
          const att = await api.get<AssetAttachment>(`/attachments/${encodeURIComponent(id)}`);
          return att.version;
        };
        if (coverPhoto?.serverId) {
          const version = await fetchVersion(coverPhoto.serverId);
          await api.patch(`/attachments/${encodeURIComponent(coverPhoto.serverId)}/review`, {
            version, isCover: true,
          });
        }
        for (const p of activePhotos) {
          if (p.serverId && p.serverId !== coverPhoto?.serverId && p.isCover !== false) {
            const version = await fetchVersion(p.serverId);
            await api.patch(`/attachments/${encodeURIComponent(p.serverId)}/review`, {
              version, isCover: false,
            });
          }
        }
      }

      // Upload new photos
      for (const photo of newPhotoMedia) {
        if (!photo.originalFile || photo.deleted) continue;
        const params = new URLSearchParams({
          clientMediaId: photo.id,
          kind: photo.kind || 'asset',
          mediaClass: 'ASSET_PHOTO',
          captureSource: photo.source,
          processingMode: 'OBJECT_CROP',
        });
        if (photo.description?.trim()) params.set('description', photo.description.trim());
        if (photo.isCover) params.set('isCover', 'true');

        const attachment = await api.upload<AssetAttachment>(
          `/assets/${encodeURIComponent(asset.id)}/attachments/upload?${params.toString()}`,
          photo.originalFile,
          {
            'Content-Type': photo.mime,
            'X-Filename': encodeUploadFilename(photo.filename),
            'Idempotency-Key': `${asset.id}-${photo.id}-upload`,
          },
        );

        if (photo.crop && photo.mime.startsWith('image/')) {
          const cropped = await renderCroppedPhoto(photo.originalFile, photo.crop);
          await api.upload(
            `/attachments/${encodeURIComponent(attachment.id)}/variants/upload?kind=CROPPED`,
            cropped,
            { 'Content-Type': cropped.type },
          );
        }

        await api.patch(`/attachments/${encodeURIComponent(attachment.id)}/review`, {
          version: attachment.version,
          kind: photo.kind || 'asset',
          mediaClass: 'ASSET_PHOTO',
          processingMode: 'OBJECT_CROP',
          processingMetadata: {
            clientMediaId: photo.id,
            originalFilename: photo.filename,
            sourceWidth: photo.width,
            sourceHeight: photo.height,
            crop: photo.crop,
            transformVersion: 1,
          },
          userConfirmed: true,
          description: photo.description?.trim() || null,
          isCover: photo.isCover,
        });
      }

      // Upload new documents
      for (const doc of newDocs) {
        if (!doc.originalFile || doc.deleted) continue;
        const params = new URLSearchParams({
          clientMediaId: doc.id,
          kind: doc.documentType || 'document',
          mediaClass: 'DOCUMENT',
          captureSource: doc.source,
          processingMode: doc.mime === 'application/pdf' ? 'NONE' : 'DOCUMENT_SCAN',
        });
        if (doc.description?.trim()) params.set('description', doc.description.trim());

        const attachment = await api.upload<AssetAttachment>(
          `/assets/${encodeURIComponent(asset.id)}/attachments/upload?${params.toString()}`,
          doc.originalFile,
          {
            'Content-Type': doc.mime,
            'X-Filename': encodeUploadFilename(doc.filename),
            'Idempotency-Key': `${asset.id}-${doc.id}-upload`,
          },
        );

        const processingMetadata: Record<string, unknown> = {
          clientMediaId: doc.id,
          originalFilename: doc.filename,
          sourceWidth: doc.width,
          sourceHeight: doc.height,
          transformVersion: 1,
        };
        if (doc.corners) {
          processingMetadata.corners = [
            doc.corners.topLeft,
            doc.corners.topRight,
            doc.corners.bottomRight,
            doc.corners.bottomLeft,
          ];
        }

        if (doc.corners && doc.mime.startsWith('image/')) {
          const scan = await renderDocumentScan(doc.originalFile, doc.corners);
          await api.upload(
            `/attachments/${encodeURIComponent(attachment.id)}/variants/upload?kind=SCAN_COLOR`,
            scan,
            { 'Content-Type': scan.type },
          );
        }

        await api.patch(`/attachments/${encodeURIComponent(attachment.id)}/review`, {
          version: attachment.version,
          kind: doc.documentType || 'document',
          mediaClass: 'DOCUMENT',
          processingMode: doc.mime === 'application/pdf' ? 'NONE' : 'DOCUMENT_SCAN',
          processingMetadata,
          userConfirmed: true,
          description: doc.description?.trim() || null,
        });
      }

      // Save metadata if changed
      if (Object.keys(patch).length > 1) {
        await api.patch(`/assets/${encodeURIComponent(asset.id)}`, patch);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      onDone();
    },
    onError: (error: Error) => {
      setSaveError(error.message);
    },
  });

  function goNext() {
    const next = EDIT_STEPS[stepIndex + 1];
    if (next) setStep(next.id);
  }

  function goBack() {
    const prev = EDIT_STEPS[stepIndex - 1];
    if (prev) setStep(prev.id);
  }

  function editPhotoPatch(id: string, next: Partial<EditPhoto>) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  }

  function deletePhoto(id: string) {
    const photo = photos.find((p) => p.id === id);
    if (photo?.serverId) deletedPhotoIds.current.add(photo.serverId);
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, deleted: true } : p)));
  }

  function deleteDoc(id: string) {
    const doc = documents.find((d) => d.id === id);
    if (doc?.serverId) deletedDocIds.current.add(doc.serverId);
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, deleted: true } : d)));
  }

  return (
    <div className="min-w-0">
      <form
        className="mx-auto min-w-0 max-w-5xl"
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (step === 'review' && !saving) {
            setSaving(true);
            saveMutation.mutate();
          }
        }}
      >
        <fieldset disabled={saving} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <header className="space-y-3" data-wizard-top>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-accent dark:text-teal-400">
                  編輯持有庫存
                </p>
                <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
              </div>
            </div>

            <p
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={EDIT_STEPS.length}
              aria-valuenow={stepIndex + 1}
              className="text-sm text-slate-600 dark:text-slate-300"
            >
              第 {stepIndex + 1}／{EDIT_STEPS.length} 步：
              {EDIT_STEPS[stepIndex]?.label}
            </p>

            <nav className="max-w-full overflow-x-auto pb-1" aria-label="編輯步驟">
              <ol className="grid min-w-[34rem] grid-cols-6 gap-1">
                {EDIT_STEPS.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={step === s.id ? 'step' : undefined}
                      disabled={i > stepIndex}
                      className={`min-h-11 w-full rounded-lg px-2 py-2 text-xs font-medium motion-safe:transition-colors ${
                        step === s.id
                          ? 'bg-accent text-white shadow-sm'
                          : i <= stepIndex
                            ? 'interactive-muted bg-slate-100 dark:bg-slate-800'
                            : 'bg-slate-100 text-slate-400 opacity-60 dark:bg-slate-900 dark:text-slate-600'
                      }`}
                      onClick={() => i <= stepIndex && setStep(s.id)}
                    >
                      <span className="block">{i + 1}</span>
                      <span>{s.shortLabel}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          </header>

          <main className="min-w-0 motion-safe:transition-opacity">
            {step === 'transaction' && (
              <TransactionStep asset={asset} />
            )}
            {step === 'details' && (
              <DetailsStep
                asset={asset}
                quantity={quantity}
                unitWeight={unitWeight}
                purity={purity}
                serial={serial}
                storageLocation={storageLocation}
                name={name}
                brand={brand}
                country={country}
                yearOrVersion={yearOrVersion}
                packagingState={packagingState}
                hasCertificate={hasCertificate}
                onQuantity={setQuantity}
                onUnitWeight={setUnitWeight}
                onPurity={setPurity}
                onSerial={setSerial}
                onStorageLocation={setStorageLocation}
                onName={setName}
                onBrand={setBrand}
                onCountry={setCountry}
                onYearOrVersion={setYearOrVersion}
                onPackagingState={setPackagingState}
                onHasCertificate={setHasCertificate}
              />
            )}
            {step === 'costs' && (
              <CostsStep
                currency={asset.currency}
                allocatedCost={allocatedCost}
                onChange={setAllocatedCost}
              />
            )}
            {step === 'photos' && (
              <PhotoStep
                photos={photos}
                newPhotos={newPhotoMedia}
                onPatchExisting={editPhotoPatch}
                onDeleteExisting={deletePhoto}
                onPatchNew={(id, next) =>
                  setNewPhotoMedia((prev) =>
                    prev.map((p) => (p.id === id ? { ...p, ...next } : p)),
                  )
                }
                onDeleteNew={(id) => {
                  const photo = newPhotoMedia.find((p) => p.id === id);
                  if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
                  setNewPhotoMedia((prev) => prev.filter((p) => p.id !== id));
                }}
                onSetCover={(id) => {
                  setPhotos((prev) => prev.map((p) => ({ ...p, isCover: p.id === id })));
                  setNewPhotoMedia((prev) => prev.map((p) => ({ ...p, isCover: p.id === id })));
                }}
                onAdd={(files) => {
                  const isFirst = photos.filter((p) => !p.deleted).length === 0 && newPhotoMedia.length === 0;
                  for (const file of files) {
                    const media = createWizardMedia(file, 'ASSET_PHOTO', 'LIBRARY');
                    setNewPhotoMedia((prev) => [
                      ...prev,
                      {
                        id: media.id,
                        kind: 'front',
                        isCover: isFirst && prev.length === 0,
                        description: '',
                        filename: media.filename,
                        mime: media.mime,
                        sizeBytes: media.sizeBytes,
                        source: 'LIBRARY',
                        originalFile: file,
                        previewUrl: media.previewUrl,
                        crop: media.crop,
                        needsReselection: false,
                      },
                    ]);
                  }
                }}
              />
            )}
            {step === 'documents' && (
              <DocStep
                documents={documents}
                newDocs={newDocs}
                onAdd={(files) => {
                  for (const file of files) {
                    const media = createWizardMedia(file, 'DOCUMENT', 'LIBRARY');
                    setNewDocs((prev) => [
                      ...prev,
                      {
                        id: media.id,
                        documentType: 'invoice',
                        description: '',
                        filename: media.filename,
                        mime: media.mime,
                        sizeBytes: media.sizeBytes,
                        source: 'LIBRARY',
                        originalFile: file,
                        previewUrl: media.previewUrl,
                        corners: media.documentCorners,
                        needsReselection: false,
                      },
                    ]);
                  }
                }}
                onDelete={deleteDoc}
                onPatch={(id, next) =>
                  setDocuments((prev) =>
                    prev.map((d) => (d.id === id ? { ...d, ...next } : d)),
                  )
                }
                onPatchNew={(id, next) =>
                  setNewDocs((prev) =>
                    prev.map((d) => (d.id === id ? { ...d, ...next } : d)),
                  )
                }
              />
            )}
            {step === 'review' && (
              <ReviewStep
                asset={asset}
                name={name}
                serial={serial}
                storageLocation={storageLocation}
                brand={brand}
                country={country}
                yearOrVersion={yearOrVersion}
                packagingState={packagingState}
                hasCertificate={hasCertificate}
                quantity={quantity}
                unitWeight={unitWeight}
                purity={purity}
                allocatedCost={allocatedCost}
                photoCount={photos.filter((p) => !p.deleted).length + newPhotoMedia.filter((p) => !p.deleted).length}
                docCount={newDocs.filter((d) => !d.deleted).length}
              />
            )}
          </main>

          {saveError && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-danger dark:bg-red-950">
              {saveError}
            </p>
          )}

          <footer className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:mx-0 sm:rounded-xl sm:border">
            <button
              type="button"
              disabled={stepIndex === 0 || saving}
              className="interactive-muted rounded-lg px-4 font-medium disabled:opacity-30"
              onClick={goBack}
            >
              上一步
            </button>
            {step === 'review' ? (
              <button
                type="submit"
                disabled={saving}
                className="ml-auto rounded-lg bg-accent px-5 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
              >
                {saving ? '正在儲存…' : '確認並儲存'}
              </button>
            ) : (
              <button
                type="button"
                className="ml-auto rounded-lg bg-accent px-5 font-medium text-white shadow-sm hover:bg-teal-800 dark:hover:bg-teal-600"
                onClick={goNext}
              >
                下一步
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              className="interactive-muted rounded-lg px-3 text-sm font-medium disabled:opacity-30"
              onClick={onCancel}
            >
              取消
            </button>
          </footer>
        </fieldset>
      </form>
    </div>
  );
}

function TransactionStep({ asset }: { asset: HeldAssetListItem }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">交易資訊</h2>
      <div className="surface rounded-xl p-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InfoItem label="交易商" value={asset.purchase?.dealerName ?? '—'} />
          <InfoItem label="購入日期" value={asset.purchase?.purchasedAt ? new Date(asset.purchase.purchasedAt).toLocaleDateString('zh-TW') : '—'} />
          <InfoItem label="幣別" value={asset.currency} />
          <InfoItem label="金屬" value={`${asset.metal.code} — ${asset.metal.name}`} />
          <InfoItem label="形式" value={asset.form ?? '—'} />
        </dl>
      </div>
    </section>
  );
}

function DetailsStep({
  asset,
  quantity, onQuantity,
  unitWeight, onUnitWeight,
  purity, onPurity,
  serial, onSerial,
  storageLocation, onStorageLocation,
  name, onName,
  brand, onBrand,
  country, onCountry,
  yearOrVersion, onYearOrVersion,
  packagingState, onPackagingState,
  hasCertificate, onHasCertificate,
}: {
  asset: HeldAssetListItem;
  quantity: string; onQuantity: (v: string) => void;
  unitWeight: string; onUnitWeight: (v: string) => void;
  purity: string; onPurity: (v: string) => void;
  serial: string; onSerial: (v: string) => void;
  storageLocation: string; onStorageLocation: (v: string) => void;
  name: string; onName: (v: string) => void;
  brand: string; onBrand: (v: string) => void;
  country: string; onCountry: (v: string) => void;
  yearOrVersion: string; onYearOrVersion: (v: string) => void;
  packagingState: string; onPackagingState: (v: string) => void;
  hasCertificate: boolean; onHasCertificate: (v: boolean) => void;
}) {
  const hasProduct = Boolean(asset.productDefinitionId);
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">商品資訊</h2>
      <div className="surface rounded-xl p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <EditField label="數量" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={onQuantity} />
          <EditField label="單件重量 (g)" type="number" inputMode="decimal" min="0.000000001" step="any" value={unitWeight} onChange={onUnitWeight} />
          <EditField label="純度" type="number" inputMode="decimal" min="0.0000001" max="1" step="any" value={purity} onChange={onPurity} />
          <EditField label="商品名稱" value={name} onChange={onName} />
          {!hasProduct && <EditField label="品牌" value={brand} onChange={onBrand} />}
          {!hasProduct && <EditField label="國家" value={country} onChange={onCountry} />}
          <EditField label="年份/版本" value={yearOrVersion} onChange={onYearOrVersion} />
          <EditField label="序號" value={serial} onChange={onSerial} maxLength={128} />
          <EditField label="存放位置" value={storageLocation} onChange={onStorageLocation} maxLength={128} />
          <label className="block space-y-1 text-sm">
            <span className="font-medium">包裝狀態</span>
            <input className="w-full rounded-lg border px-2 py-1.5" value={packagingState} onChange={(e) => onPackagingState(e.target.value)} maxLength={64} />
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">
            <input type="checkbox" className="h-5 w-5" checked={hasCertificate} onChange={(e) => onHasCertificate(e.target.checked)} />
            <span className="font-medium">附有證書</span>
          </label>
        </div>
      </div>
    </section>
  );
}

function CostsStep({ currency, allocatedCost, onChange }: { currency: string; allocatedCost: string; onChange: (v: string) => void }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">成本</h2>
      <div className="surface rounded-xl p-4">
        <div className="max-w-xs">
          <EditField label={`分攤成本 (${currency})`} type="number" inputMode="decimal" min="0" step="any" value={allocatedCost} onChange={onChange} />
          <p className="mt-1 text-xs text-slate-400">更正持有成本，不影響原始入庫總額</p>
        </div>
      </div>
    </section>
  );
}

function PhotoStep({
  photos, newPhotos, onPatchExisting, onDeleteExisting, onPatchNew, onDeleteNew, onSetCover, onAdd,
}: {
  photos: EditPhoto[];
  newPhotos: EditPhoto[];
  asset?: HeldAssetListItem;
  onPatchExisting: (id: string, next: Partial<EditPhoto>) => void;
  onDeleteExisting: (id: string) => void;
  onPatchNew: (id: string, next: Partial<EditPhoto>) => void;
  onDeleteNew: (id: string) => void;
  onSetCover: (id: string) => void;
  onAdd: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const existingPhotos = photos.filter((p) => !p.deleted);
  const activeNew = newPhotos.filter((p) => !p.deleted);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">照片管理</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        新增或移除商品照片。主要照片會顯示在庫存清單中。
      </p>

      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          onAdd(files);
        }}
      />
      <button
        type="button"
        className="rounded-xl bg-accent px-4 py-3 font-medium text-white shadow-sm hover:bg-teal-800 dark:hover:bg-teal-600"
        onClick={() => inputRef.current?.click()}
      >
        新增照片
      </button>

      {existingPhotos.length === 0 && activeNew.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          尚無照片
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {existingPhotos.map((photo) => (
            <ExistingPhotoCard
              key={photo.id}
              photo={photo}
              onPatch={(next) => onPatchExisting(photo.id, next)}
              onDelete={() => onDeleteExisting(photo.id)}
              onSetCover={() => onSetCover(photo.id)}
            />
          ))}
          {activeNew.map((photo) => (
            <NewPhotoCard
              key={photo.id}
              photo={photo}
              onPatch={(next) => onPatchNew(photo.id, next)}
              onDelete={() => onDeleteNew(photo.id)}
              onSetCover={() => onSetCover(photo.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ExistingPhotoCard({
  photo, onPatch, onDelete, onSetCover,
}: {
  photo: EditPhoto;
  onPatch: (next: Partial<EditPhoto>) => void;
  onDelete: () => void;
  onSetCover: () => void;
}) {
  const signedUrl = useQuery({
    queryKey: ['attachment-read-url', photo.serverId, photo.variantKind, photo.variantRevision],
    queryFn: () => {
      const params = new URLSearchParams();
      if (photo.variantKind) params.set('variant', photo.variantKind);
      if (photo.variantRevision) params.set('revision', String(photo.variantRevision));
      return api.get<{ url: string }>(
        `/attachments/${encodeURIComponent(photo.serverId!)}/url?${params.toString()}`,
      );
    },
    enabled: Boolean(photo.serverId),
    staleTime: 20_000,
  });

  return (
    <div className="surface min-w-0 space-y-3 rounded-xl p-3">
      <div className="flex min-h-32 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        {signedUrl.isPending ? (
          <div className="h-32 w-full animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
        ) : signedUrl.data?.url ? (
          <img src={signedUrl.data.url} alt={photo.filename} className="max-h-48 max-w-full rounded object-contain" loading="lazy" decoding="async" />
        ) : (
          <p className="text-xs text-slate-500">載入失敗</p>
        )}
      </div>
      <input className="w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="說明（選填）" maxLength={200}
        value={photo.description} onChange={(e) => onPatch({ description: e.target.value })} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSetCover} className={`min-h-11 rounded-lg px-3 text-sm font-medium ${photo.isCover ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' : 'border'}`}>
          {photo.isCover ? '✓ 主要照片' : '設為主要'}
        </button>
        <button type="button" onClick={onDelete} className="ml-auto rounded-lg px-3 text-sm font-medium text-danger hover:bg-red-50 dark:hover:bg-red-950">
          移除
        </button>
      </div>
    </div>
  );
}

function NewPhotoCard({
  photo, onPatch, onDelete, onSetCover,
}: {
  photo: EditPhoto;
  onPatch: (next: Partial<EditPhoto>) => void;
  onDelete: () => void;
  onSetCover: () => void;
}) {
  return (
    <div className="surface min-w-0 space-y-3 rounded-xl p-3">
      {photo.previewUrl && (
        <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-slate-950">
          <img src={photo.previewUrl} alt={photo.filename} className="block max-h-48 w-auto max-w-full object-contain" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <select className="rounded-lg border px-2 py-1.5 text-sm" value={photo.kind} onChange={(e) => onPatch({ kind: e.target.value })}>
          <option value="front">正面</option>
          <option value="back">背面</option>
          <option value="side">側面／幣邊</option>
          <option value="serial">序號</option>
          <option value="security">防偽標誌</option>
          <option value="packaging">包裝</option>
        </select>
      </div>
      <input className="w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="說明（選填）" maxLength={200}
        value={photo.description} onChange={(e) => onPatch({ description: e.target.value })} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSetCover} className={`min-h-11 rounded-lg px-3 text-sm font-medium ${photo.isCover ? 'bg-teal-100 text-teal-800' : 'border'}`}>
          {photo.isCover ? '✓ 主要照片' : '設為主要'}
        </button>
        <button type="button" onClick={onDelete} className="ml-auto rounded-lg px-3 text-sm font-medium text-danger">
          移除
        </button>
      </div>
    </div>
  );
}

function DocStep({
  documents, newDocs, onAdd, onDelete, onPatch: _onPatch, onPatchNew,
}: {
  documents: EditDocument[];
  newDocs: EditDocument[];
  onAdd: (files: File[]) => void;
  onDelete: (id: string) => void;
  onPatch: (id: string, next: Partial<EditDocument>) => void;
  onPatchNew: (id: string, next: Partial<EditDocument>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const allDocs = [...documents.filter((d) => !d.deleted), ...newDocs.filter((d) => !d.deleted)];

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">文件</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">上傳發票、收據或證書等文件。</p>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          onAdd(files);
        }}
      />
      <button type="button" className="rounded-xl bg-accent px-4 py-3 font-medium text-white" onClick={() => inputRef.current?.click()}>
        新增文件
      </button>
      {allDocs.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">尚無文件</p>
      )}
      <ol className="space-y-4">
        {newDocs.filter((d) => !d.deleted).map((doc) => (
          <li key={doc.id} className="surface min-w-0 space-y-3 rounded-xl p-3">
            <p className="text-sm font-medium">{doc.filename}</p>
            <select className="rounded-lg border px-2 py-1.5 text-sm" value={doc.documentType} onChange={(e) => onPatchNew(doc.id, { documentType: e.target.value })}>
              <option value="invoice">發票</option>
              <option value="receipt">收據</option>
              <option value="certificate">證書</option>
              <option value="warranty_card">保卡</option>
            </select>
            <button type="button" onClick={() => onDelete(doc.id)} className="rounded-lg px-3 text-sm font-medium text-danger">
              移除
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReviewStep({
  asset, name, serial, storageLocation, brand, country, yearOrVersion,
  packagingState, hasCertificate, quantity, unitWeight, purity, allocatedCost,
  photoCount, docCount,
}: {
  asset: HeldAssetListItem;
  name: string; serial: string; storageLocation: string;
  brand: string; country: string; yearOrVersion: string;
  packagingState: string; hasCertificate: boolean;
  quantity: string; unitWeight: string; purity: string; allocatedCost: string;
  photoCount: number; docCount: number;
}) {
  const changes: { label: string; before: string; after: string }[] = [];
  const push = (label: string, before: string, after: string) => {
    if (before !== after) changes.push({ label, before: before || '未設定', after: after || '未設定' });
  };
  push('商品名稱', asset.name ?? '', name);
  push('數量', String(asset.quantity), quantity);
  push('單件重量', formatGrams(asset.unitWeightGrams, 'g') as string, `${unitWeight} g`);
  push('純度', `${Number(asset.purity) * 100}%`, `${Number(purity) * 100}%`);
  push('分攤成本', formatMoney(asset.allocatedCost, asset.currency) as string, formatMoney(allocatedCost, asset.currency) as string);
  push('序號', asset.serial ?? '', serial);
  push('存放位置', asset.storageLocation ?? '', storageLocation);
  push('品牌', asset.brand ?? '', brand);
  push('國家', asset.country ?? '', country);
  push('年份/版本', asset.yearOrVersion ?? '', yearOrVersion);
  push('包裝狀態', asset.packagingState ?? '', packagingState);
  if (asset.hasCertificate !== hasCertificate) {
    push('附有證書', asset.hasCertificate ? '是' : '否', hasCertificate ? '是' : '否');
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">確認變更</h2>
      {changes.length === 0 && photoCount === 0 && docCount === 0 ? (
        <p className="rounded-xl border border-slate-300 p-4 text-sm text-slate-500">未做任何變更。</p>
      ) : (
        <div className="space-y-3">
          {changes.length > 0 && (
            <div className="surface rounded-xl p-4">
              <h3 className="mb-3 font-medium">欄位變更</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-500"><th className="pb-2 pr-4">欄位</th><th className="pb-2 pr-4">原值</th><th className="pb-2">新值</th></tr></thead>
                <tbody>
                  {changes.map((c, i) => (
                    <tr key={i} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-2 pr-4 font-medium">{c.label}</td>
                      <td className="py-2 pr-4 text-slate-500 line-through">{c.before}</td>
                      <td className="py-2 font-medium text-accent">{c.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="surface rounded-xl p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <InfoItem label="照片" value={`${photoCount} 張`} />
              <InfoItem label="文件" value={`${docCount} 份`} />
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}

function EditField({
  label, value, onChange, type = 'text', inputMode, min, max, step, maxLength,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; inputMode?: 'decimal' | 'numeric'; min?: string; max?: string; step?: string; maxLength?: number;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <input className="w-full rounded-lg border px-2 py-1.5" type={type} inputMode={inputMode} min={min} max={max} step={step} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="break-words font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function encodeUploadFilename(filename: string): string {
  return `UTF-8''${encodeURIComponent(filename)}`;
}
