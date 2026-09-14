import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api, type AssetAttachment, type HeldAssetListItem } from '../api.js';
import { CustomSelect } from '../CustomSelect.js';
import { WizardBack, WizardNext, WizardShell, WizardSubmit } from '../WizardShell.js';
import { createWizardMedia } from '../purchase-wizard/media-utils.js';
import { renderCroppedPhoto, renderDocumentScan } from '../purchase-wizard/index.js';
import { productFormLabel, productFormOptions } from '../product-forms.js';
import { formatGrams, formatMoney } from '../units.js';
import { WEIGHT_UNITS, WEIGHT_UNIT_LONG_LABELS, type WeightUnit } from '@bullion-ledger/shared';
import {
  COST_CURRENCIES,
  OVERRIDABLE_FIELDS,
  attachmentReadPath,
  attachmentReviewPatches,
  assetPatchHasChanges,
  buildAssetPatch,
  buildPurchasePatch,
  currencyChangeScope,
  documentPreview,
  initialAssetForm,
  initialPurchaseForm,
  isPurchaseScoped,
  previewVariant,
  unitWeightInUnit,
  type AssetEditForm,
  type AttachmentEdit,
  type OverridableField,
  type PurchaseEditForm,
} from './asset-edit-model.js';
import {
  ASSET_EDIT_STEPS,
  assetEditStepIndex,
  assetEditStepLabel,
  nextAssetEditStep,
  previousAssetEditStep,
  type AssetEditStep,
} from './inventory-route.js';

type UploadedVariant = { kind: string; revision: number; attachmentVersion: number };

const PHOTO_KINDS: ReadonlyArray<readonly [string, string]> = [
  ['front', '正面'],
  ['back', '背面'],
  ['side', '側面／幣邊'],
  ['serial', '序號'],
  ['security', '防偽標誌'],
  ['packaging', '包裝'],
  ['other', '其他'],
];

const DOCUMENT_KINDS: ReadonlyArray<readonly [string, string]> = [
  ['invoice', '發票'],
  ['receipt', '收據'],
  ['certificate', '證書'],
  ['warranty_card', '保卡'],
  ['other', '其他'],
];

type Corners = {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
};

interface ExistingPhoto extends AttachmentEdit {
  filename: string;
  mime: string;
  variant: { kind: string; revision: number } | null;
}

interface ExistingDocument extends AttachmentEdit {
  filename: string;
  mime: string;
  sizeBytes: number;
  purchaseScoped: boolean;
  variant: { kind: string; revision: number } | null;
}

interface NewMedia {
  id: string;
  kind: string;
  isCover: boolean;
  description: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  source: 'CAMERA' | 'LIBRARY';
  originalFile: File;
  previewUrl?: string;
  crop?: { x: number; y: number; width: number; height: number };
  corners?: Corners;
  width?: number;
  height?: number;
}

interface AssetEditWizardProps {
  asset: HeldAssetListItem;
  /** Current step, owned by the URL so back/reload land on the same panel. */
  step: AssetEditStep;
  onStep: (step: AssetEditStep) => void;
  onDone: () => void;
  onCancel: () => void;
}

export function AssetEditWizard({ asset, step, onStep, onDone, onCancel }: AssetEditWizardProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const [form, setForm] = useState<AssetEditForm>(() => initialAssetForm(asset));
  const [purchaseForm, setPurchaseForm] = useState<PurchaseEditForm>(() =>
    initialPurchaseForm(asset),
  );
  const patchField = <K extends keyof AssetEditForm>(key: K, value: AssetEditForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const attachments = useQuery({
    queryKey: ['asset-attachments', asset.id],
    queryFn: () =>
      api.get<AssetAttachment[]>(`/assets/${encodeURIComponent(asset.id)}/attachments`),
  });

  // The listing is the only source with attachment versions, so it seeds both
  // the editable copies and the baseline a save diffs against.
  const serverPhotos = useMemo(() => toExistingPhotos(attachments.data), [attachments.data]);
  const serverDocuments = useMemo(() => toExistingDocuments(attachments.data), [attachments.data]);

  const [photos, setPhotos] = useState<ExistingPhoto[]>([]);
  const [documents, setDocuments] = useState<ExistingDocument[]>([]);
  const [newPhotos, setNewPhotos] = useState<NewMedia[]>([]);
  const [newDocs, setNewDocs] = useState<NewMedia[]>([]);
  const deletedIds = useRef(new Set<string>());

  useEffect(() => setPhotos(serverPhotos), [serverPhotos]);
  useEffect(() => setDocuments(serverDocuments), [serverDocuments]);

  // Object URLs for local previews outlive a single render; release them when
  // the editor closes so a long editing session does not leak every picked
  // file. The ref keeps the unmount cleanup reading the final list without
  // re-registering (and therefore revoking early) on every pick.
  const pendingPreviews = useRef<string[]>([]);
  pendingPreviews.current = [...newPhotos, ...newDocs]
    .map((media) => media.previewUrl)
    .filter((url): url is string => Boolean(url));
  useEffect(
    () => () => {
      for (const url of pendingPreviews.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const stepIndex = assetEditStepIndex(step);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const result = buildAssetPatch(asset, form);
      if ('error' in result) throw new Error(result.error);
      const patch = result.patch;
      const purchasePatch = buildPurchasePatch(asset, purchaseForm, form);

      for (const id of deletedIds.current) {
        await api.delete(`/attachments/${encodeURIComponent(id)}`);
      }

      // Promote the new cover first: the server demotes the previous one in the
      // same transaction, so no explicit isCover:false call is needed.
      for (const review of attachmentReviewPatches(
        [...serverPhotos, ...serverDocuments],
        [...photos, ...documents],
      )) {
        await api.patch(`/attachments/${encodeURIComponent(review.id)}/review`, review.body);
      }

      for (const photo of newPhotos) {
        await uploadAssetMedia(asset.id, photo, 'ASSET_PHOTO');
      }
      for (const doc of newDocs) {
        await uploadAssetMedia(asset.id, doc, 'DOCUMENT');
      }

      if (assetPatchHasChanges(patch)) {
        await api.patch(`/assets/${encodeURIComponent(asset.id)}`, patch);
      }
      if (asset.purchase && Object.keys(purchasePatch).length > 0) {
        await api.patch(`/purchases/${encodeURIComponent(asset.purchase.id)}`, purchasePatch);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['asset-attachments', asset.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['purchases'] });
      onDone();
    },
    onError: (error: Error) => {
      setSaving(false);
      setSaveError(error.message);
    },
  });

  function addFiles(files: File[], target: 'photo' | 'document', source: 'CAMERA' | 'LIBRARY') {
    const setter = target === 'photo' ? setNewPhotos : setNewDocs;
    const noCoverYet =
      target === 'photo' && photos.every((p) => !p.isCover) && newPhotos.every((p) => !p.isCover);
    setter((prev) => [
      ...prev,
      ...files.map((file, index) => {
        const media = createWizardMedia(
          file,
          target === 'photo' ? 'ASSET_PHOTO' : 'DOCUMENT',
          source,
        );
        return {
          id: media.id,
          kind: target === 'photo' ? 'front' : 'invoice',
          isCover: noCoverYet && prev.length === 0 && index === 0,
          description: '',
          filename: media.filename,
          mime: media.mime,
          sizeBytes: media.sizeBytes,
          source,
          originalFile: file,
          previewUrl: media.previewUrl,
          crop: media.crop,
          corners: media.documentCorners,
        } satisfies NewMedia;
      }),
    ]);
  }

  function removeExisting(id: string) {
    deletedIds.current.add(id);
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  function removeNew(id: string) {
    for (const list of [newPhotos, newDocs]) {
      const media = list.find((m) => m.id === id);
      if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl);
    }
    setNewPhotos((prev) => prev.filter((m) => m.id !== id));
    setNewDocs((prev) => prev.filter((m) => m.id !== id));
  }

  function selectCover(id: string) {
    setPhotos((prev) => prev.map((p) => ({ ...p, isCover: p.id === id })));
    setNewPhotos((prev) => prev.map((p) => ({ ...p, isCover: p.id === id })));
  }

  return (
    <WizardShell
      eyebrow="編輯持有庫存"
      subject={asset.name}
      stepLabel={assetEditStepLabel(step)}
      stepIndex={stepIndex}
      stepCount={ASSET_EDIT_STEPS.length}
      scrollKey={step}
      busy={saving}
      onCancel={onCancel}
      onSubmit={() => {
        if (step === 'review' && !saving) {
          setSaving(true);
          setSaveError(null);
          saveMutation.mutate();
        }
      }}
      error={
        saveError ? (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-danger dark:bg-red-950"
          >
            {saveError}
          </p>
        ) : null
      }
      footer={
        <>
          <WizardBack
            disabled={stepIndex === 0 || saving}
            onClick={() => {
              const previous = previousAssetEditStep(step);
              if (previous) onStep(previous);
            }}
          />
          {step === 'review' ? (
            <WizardSubmit busy={saving} idle="確認並儲存" working="正在儲存…" />
          ) : (
            <WizardNext
              onClick={() => {
                const next = nextAssetEditStep(step);
                if (next) onStep(next);
              }}
            />
          )}
        </>
      }
    >
      {step === 'transaction' && (
        <TransactionStep asset={asset} form={purchaseForm} onChange={setPurchaseForm} />
      )}
      {step === 'description' && (
        <DescriptionStep asset={asset} form={form} onChange={patchField} />
      )}
      {step === 'spec' && <SpecStep asset={asset} form={form} onChange={patchField} />}
      {step === 'cost' && <CostStep asset={asset} form={form} onChange={patchField} />}
      {step === 'custody' && <CustodyStep form={form} onChange={patchField} />}
      {step === 'photos' && (
        <PhotoStep
          loading={attachments.isPending}
          error={attachments.error?.message ?? null}
          photos={photos}
          newPhotos={newPhotos}
          onPatch={(id, next) =>
            setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)))
          }
          onPatchNew={(id, next) =>
            setNewPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)))
          }
          onDelete={removeExisting}
          onDeleteNew={removeNew}
          onSetCover={selectCover}
          onAdd={(files, source) => addFiles(files, 'photo', source)}
        />
      )}
      {step === 'documents' && (
        <DocStep
          loading={attachments.isPending}
          error={attachments.error?.message ?? null}
          documents={documents}
          newDocs={newDocs}
          onPatch={(id, next) =>
            setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...next } : d)))
          }
          onPatchNew={(id, next) =>
            setNewDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...next } : d)))
          }
          onDelete={removeExisting}
          onDeleteNew={removeNew}
          onAdd={(files, source) => addFiles(files, 'document', source)}
        />
      )}
      {step === 'review' && (
        <ReviewStep
          asset={asset}
          form={form}
          purchaseForm={purchaseForm}
          photoCount={photos.length + newPhotos.length}
          docCount={documents.length + newDocs.length}
          addedCount={newPhotos.length + newDocs.length}
          removedCount={deletedIds.current.size}
        />
      )}
    </WizardShell>
  );
}

function TransactionStep({
  asset,
  form,
  onChange,
}: {
  asset: HeldAssetListItem;
  form: PurchaseEditForm;
  onChange: (next: PurchaseEditForm) => void;
}) {
  const set = (key: keyof PurchaseEditForm) => (value: string) =>
    onChange({ ...form, [key]: value });

  return (
    <section className="space-y-4">
      {asset.purchase ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            這些欄位屬於整筆買入，同一筆交易的其他批次也會一起更新。
          </p>
          <div className="surface rounded-xl p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <EditField
                label="交易商"
                value={form.dealerName}
                onChange={set('dealerName')}
                maxLength={200}
              />
              <EditField
                label="分店／櫃點"
                value={form.branch}
                onChange={set('branch')}
                maxLength={200}
              />
              <EditField
                label="訂單編號"
                value={form.orderNumber}
                onChange={set('orderNumber')}
                maxLength={120}
              />
              <EditField
                label="發票號碼"
                value={form.invoiceNumber}
                onChange={set('invoiceNumber')}
                maxLength={120}
              />
              <EditField
                label="付款方式"
                value={form.paymentMethod}
                onChange={set('paymentMethod')}
                maxLength={60}
              />
              <label className="block space-y-1 text-sm sm:col-span-2">
                <span className="font-medium">備註</span>
                <textarea
                  className="w-full rounded-lg border px-2 py-1.5"
                  rows={3}
                  maxLength={2000}
                  value={form.notes}
                  onChange={(event) => set('notes')(event.target.value)}
                />
              </label>
            </div>
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          這批庫存不是由買入建立的，沒有可編輯的交易資訊。
        </p>
      )}

      <div className="surface rounded-xl p-4">
        <h3 className="font-medium">在別處修改</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          幣別請到「成本與幣別」那一步更改。購入日期與金屬決定了成本分攤與購入當下的行情快照，
          改動會讓已存的溢價與熔值失真，因此只能透過重新建檔更正。
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InfoItem label="幣別" value={`${asset.currency}（可於「成本與幣別」修改）`} />
          <InfoItem
            label="購入日期"
            value={
              asset.purchase?.purchasedAt
                ? new Date(asset.purchase.purchasedAt).toLocaleDateString('zh-TW')
                : '—'
            }
          />
          <InfoItem label="金屬" value={`${asset.metal.code} — ${asset.metal.name}`} />
          <InfoItem
            label="入庫時間"
            value={new Date(asset.acquiredAt).toLocaleDateString('zh-TW')}
          />
        </dl>
      </div>
    </section>
  );
}

function DescriptionStep({
  asset,
  form,
  onChange,
}: {
  asset: HeldAssetListItem;
  form: AssetEditForm;
  onChange: <K extends keyof AssetEditForm>(key: K, value: AssetEditForm[K]) => void;
}) {
  return (
    <section className="space-y-4">
      {asset.productDefinitionId && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          這批庫存連結了商品規格。以下欄位預設沿用規格內容，改寫只會影響這一批，清空即可恢復沿用。
        </p>
      )}
      <div className="surface rounded-xl p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <OverrideField
            label="商品名稱"
            field="name"
            asset={asset}
            form={form}
            onChange={onChange}
          />
          <OverrideField
            label="形式"
            field="form"
            asset={asset}
            form={form}
            onChange={onChange}
            options={productFormOptions(asset.metal.code)}
            renderInherited={(value) => productFormLabel(value, asset.metal.code)}
          />
          <OverrideField label="品牌" field="brand" asset={asset} form={form} onChange={onChange} />
          <OverrideField
            label="國家"
            field="country"
            asset={asset}
            form={form}
            onChange={onChange}
          />
          <OverrideField
            label="年份／版本"
            field="yearOrVersion"
            asset={asset}
            form={form}
            onChange={onChange}
          />
        </div>
      </div>
    </section>
  );
}

function SpecStep({
  asset,
  form,
  onChange,
}: {
  asset: HeldAssetListItem;
  form: AssetEditForm;
  onChange: <K extends keyof AssetEditForm>(key: K, value: AssetEditForm[K]) => void;
}) {
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        重量與純度決定細重量，細重量決定估值，所以這裡的更正會一路傳到總覽。
      </p>
      <div className="surface rounded-xl p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EditField
            label="數量"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={form.quantity}
            onChange={(value) => onChange('quantity', value)}
          />
          <EditField
            label="純度"
            type="number"
            inputMode="decimal"
            min="0"
            max="1"
            step="any"
            value={form.purity}
            onChange={(value) => onChange('purity', value)}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2 sm:col-span-2">
            <EditField
              label="單件重量"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={form.unitWeight}
              onChange={(value) => onChange('unitWeight', value)}
            />
            <CustomSelect
              label="重量單位"
              value={form.weightUnit}
              onChange={(next) => {
                const unit = next as WeightUnit;
                // Re-express the same physical weight so switching units is a
                // display change, never a silent edit of the stored grams.
                onChange('unitWeight', unitWeightInUnit(asset.unitWeightGrams, unit));
                onChange('weightUnit', unit);
              }}
              options={WEIGHT_UNITS.map((unit) => ({
                value: unit,
                label: WEIGHT_UNIT_LONG_LABELS[unit],
              }))}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function CostStep({
  asset,
  form,
  onChange,
}: {
  asset: HeldAssetListItem;
  form: AssetEditForm;
  onChange: <K extends keyof AssetEditForm>(key: K, value: AssetEditForm[K]) => void;
}) {
  const scope = currencyChangeScope(asset);
  const changed = form.currency.trim().toUpperCase() !== asset.currency;

  return (
    <section className="space-y-4">
      <div className="surface rounded-xl p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CustomSelect
            label="幣別"
            value={form.currency}
            onChange={(value) => onChange('currency', value)}
            options={COST_CURRENCIES.map((code) => ({ value: code, label: code }))}
            hint={
              scope === 'purchase'
                ? '屬於整筆買入，同一筆交易的所有批次會一起改。'
                : '這批庫存沒有對應的買入，幣別只影響這一批。'
            }
          />
          <EditField
            label="分攤成本"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={form.allocatedCost}
            onChange={(value) => onChange('allocatedCost', value)}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          更正持有成本，不影響原始入庫總額。
        </p>
      </div>

      {changed && (
        <p
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          幣別將由 {asset.currency} 改為 {form.currency.trim().toUpperCase()}。金額數字不會被換算
          ——選錯幣別代表標籤錯了，數字本身是對的。
          {scope === 'purchase' && '購入當下的行情快照會重新計算，溢價與熔值會在背景更新。'}
        </p>
      )}
    </section>
  );
}

function CustodyStep({
  form,
  onChange,
}: {
  form: AssetEditForm;
  onChange: <K extends keyof AssetEditForm>(key: K, value: AssetEditForm[K]) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="surface rounded-xl p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EditField
            label="序號"
            value={form.serial}
            onChange={(value) => onChange('serial', value)}
            maxLength={128}
          />
          <EditField
            label="存放位置"
            value={form.storageLocation}
            onChange={(value) => onChange('storageLocation', value)}
            maxLength={128}
          />
          <EditField
            label="包裝狀態"
            value={form.packagingState}
            onChange={(value) => onChange('packagingState', value)}
            maxLength={64}
          />
          <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={form.hasCertificate}
              onChange={(event) => onChange('hasCertificate', event.target.checked)}
            />
            <span className="font-medium">附有證書</span>
          </label>
        </div>
      </div>
    </section>
  );
}

/**
 * A descriptive field that may follow the product catalog. It shows what the
 * field would read if cleared, and offers a one-tap restore when this lot has
 * diverged, so "edit just this one" and "go back to the catalog" are both
 * reachable without leaving the screen.
 */
function OverrideField({
  label,
  field,
  asset,
  form,
  onChange,
  options,
  renderInherited = (value: string) => value,
}: {
  label: string;
  field: OverridableField;
  asset: HeldAssetListItem;
  form: AssetEditForm;
  onChange: <K extends keyof AssetEditForm>(key: K, value: AssetEditForm[K]) => void;
  options?: ReadonlyArray<readonly [string, string]>;
  renderInherited?: (value: string) => string;
}) {
  const inheritedValue = asset.inherited?.[field] ?? null;
  const diverged = inheritedValue !== null && form[field].trim() !== inheritedValue;

  return (
    <div className="space-y-1">
      {options ? (
        <CustomSelect
          label={label}
          value={form[field]}
          onChange={(value) => onChange(field, value)}
          options={options.map(([value, optionLabel]) => ({ value, label: optionLabel }))}
        />
      ) : (
        <EditField label={label} value={form[field]} onChange={(value) => onChange(field, value)} />
      )}
      {inheritedValue !== null && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>商品規格：{renderInherited(inheritedValue)}</span>
          {diverged && (
            <button
              type="button"
              className="min-h-0 rounded px-1 font-medium text-accent underline-offset-2 hover:underline dark:text-teal-400"
              onClick={() => onChange(field, inheritedValue)}
            >
              恢復沿用
            </button>
          )}
        </p>
      )}
    </div>
  );
}

function PhotoStep({
  loading,
  error,
  photos,
  newPhotos,
  onPatch,
  onPatchNew,
  onDelete,
  onDeleteNew,
  onSetCover,
  onAdd,
}: {
  loading: boolean;
  error: string | null;
  photos: ExistingPhoto[];
  newPhotos: NewMedia[];
  onPatch: (id: string, next: Partial<ExistingPhoto>) => void;
  onPatchNew: (id: string, next: Partial<NewMedia>) => void;
  onDelete: (id: string) => void;
  onDeleteNew: (id: string) => void;
  onSetCover: (id: string) => void;
  onAdd: (files: File[], source: 'CAMERA' | 'LIBRARY') => void;
}) {
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        新增或移除商品照片。主要照片會顯示在庫存清單中。
      </p>

      <MediaPicker
        onAdd={onAdd}
        accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
        cameraAccept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        chooseLabel="新增照片"
      />

      <AttachmentListState
        loading={loading}
        error={error}
        empty={photos.length === 0 && newPhotos.length === 0}
        emptyLabel="尚無照片"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {photos.map((photo) => (
          <MediaCard
            key={photo.id}
            title={photo.filename}
            preview={
              <ExistingPreview
                attachmentId={photo.id}
                variant={photo.variant}
                mime={photo.mime}
                alt={photo.filename}
              />
            }
            kindOptions={PHOTO_KINDS}
            kind={photo.kind}
            onKind={(kind) => onPatch(photo.id, { kind })}
            description={photo.description}
            onDescription={(description) => onPatch(photo.id, { description })}
            isCover={photo.isCover}
            onSetCover={() => onSetCover(photo.id)}
            onDelete={() => onDelete(photo.id)}
          />
        ))}
        {newPhotos.map((photo) => (
          <MediaCard
            key={photo.id}
            title={photo.filename}
            badge="尚未上傳"
            preview={
              photo.previewUrl ? (
                <img
                  src={photo.previewUrl}
                  alt={photo.filename}
                  className="max-h-48 max-w-full rounded object-contain"
                />
              ) : null
            }
            kindOptions={PHOTO_KINDS}
            kind={photo.kind}
            onKind={(kind) => onPatchNew(photo.id, { kind })}
            description={photo.description}
            onDescription={(description) => onPatchNew(photo.id, { description })}
            isCover={photo.isCover}
            onSetCover={() => onSetCover(photo.id)}
            onDelete={() => onDeleteNew(photo.id)}
          />
        ))}
      </div>
    </section>
  );
}

function DocStep({
  loading,
  error,
  documents,
  newDocs,
  onPatch,
  onPatchNew,
  onDelete,
  onDeleteNew,
  onAdd,
}: {
  loading: boolean;
  error: string | null;
  documents: ExistingDocument[];
  newDocs: NewMedia[];
  onPatch: (id: string, next: Partial<ExistingDocument>) => void;
  onPatchNew: (id: string, next: Partial<NewMedia>) => void;
  onDelete: (id: string) => void;
  onDeleteNew: (id: string) => void;
  onAdd: (files: File[], source: 'CAMERA' | 'LIBRARY') => void;
}) {
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        發票、收據與證書。標示「整筆交易」的文件由同一筆買入的所有批次共用，移除後其他批次也看不到。
      </p>

      <MediaPicker
        onAdd={onAdd}
        accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
        cameraAccept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        chooseLabel="選擇檔案"
      />

      <AttachmentListState
        loading={loading}
        error={error}
        empty={documents.length === 0 && newDocs.length === 0}
        emptyLabel="尚無文件"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {documents.map((doc) => (
          <MediaCard
            key={doc.id}
            title={doc.filename}
            badge={doc.purchaseScoped ? '整筆交易' : '本批次'}
            preview={
              <ExistingPreview
                attachmentId={doc.id}
                variant={doc.variant}
                mime={doc.mime}
                alt={doc.filename}
              />
            }
            kindOptions={DOCUMENT_KINDS}
            kind={doc.kind}
            onKind={(kind) => onPatch(doc.id, { kind })}
            description={doc.description}
            onDescription={(description) => onPatch(doc.id, { description })}
            onDelete={() => onDelete(doc.id)}
          />
        ))}
        {newDocs.map((doc) => (
          <MediaCard
            key={doc.id}
            title={doc.filename}
            badge="尚未上傳"
            preview={
              doc.previewUrl && documentPreview(doc.mime) === 'image' ? (
                <img
                  src={doc.previewUrl}
                  alt={doc.filename}
                  className="max-h-48 max-w-full rounded object-contain"
                />
              ) : (
                <FileGlyph mime={doc.mime} />
              )
            }
            kindOptions={DOCUMENT_KINDS}
            kind={doc.kind}
            onKind={(kind) => onPatchNew(doc.id, { kind })}
            description={doc.description}
            onDescription={(description) => onPatchNew(doc.id, { description })}
            onDelete={() => onDeleteNew(doc.id)}
          />
        ))}
      </div>
    </section>
  );
}

function AttachmentListState({
  loading,
  error,
  empty,
  emptyLabel,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyLabel: string;
}) {
  if (loading) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
        正在讀取附件…
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-danger dark:bg-red-950">
        無法讀取附件：{error}
      </p>
    );
  }
  if (!empty) return null;
  return (
    <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
      {emptyLabel}
    </p>
  );
}

function MediaPicker({
  onAdd,
  accept,
  cameraAccept,
  chooseLabel,
}: {
  onAdd: (files: File[], source: 'CAMERA' | 'LIBRARY') => void;
  accept: string;
  cameraAccept: string;
  chooseLabel: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept={accept}
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          onAdd(files, 'LIBRARY');
        }}
      />
      <input
        ref={cameraRef}
        className="sr-only"
        type="file"
        accept={cameraAccept}
        capture="environment"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          onAdd(files, 'CAMERA');
        }}
      />
      <button
        type="button"
        className="rounded-xl bg-accent px-4 font-medium text-white shadow-sm hover:bg-teal-800 dark:hover:bg-teal-600"
        onClick={() => fileRef.current?.click()}
      >
        {chooseLabel}
      </button>
      <button
        type="button"
        className="rounded-xl border px-4 font-medium"
        onClick={() => cameraRef.current?.click()}
      >
        拍照
      </button>
    </div>
  );
}

function MediaCard({
  title,
  badge,
  preview,
  kindOptions,
  kind,
  onKind,
  description,
  onDescription,
  isCover,
  onSetCover,
  onDelete,
}: {
  title: string;
  badge?: string;
  preview: ReactNode;
  kindOptions: ReadonlyArray<readonly [string, string]>;
  kind: string;
  onKind: (kind: string) => void;
  description: string;
  onDescription: (description: string) => void;
  isCover?: boolean;
  onSetCover?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="surface min-w-0 space-y-3 rounded-xl p-3">
      <div className="flex min-h-32 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        {preview}
      </div>
      <div className="flex min-w-0 items-start gap-2">
        <p className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">{title}</p>
        {badge && (
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {badge}
          </span>
        )}
      </div>
      <CustomSelect
        label="類型"
        value={kind}
        onChange={onKind}
        options={kindOptions.map(([value, label]) => ({ value, label }))}
      />
      <input
        className="w-full rounded-lg border px-2 py-1.5 text-sm"
        placeholder="說明（選填）"
        maxLength={200}
        value={description}
        onChange={(event) => onDescription(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {onSetCover && (
          <button
            type="button"
            onClick={onSetCover}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium ${
              isCover ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' : 'border'
            }`}
          >
            {isCover ? '✓ 主要照片' : '設為主要'}
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto rounded-lg px-3 text-sm font-medium text-danger hover:bg-red-50 dark:hover:bg-red-950"
        >
          移除
        </button>
      </div>
    </div>
  );
}

/**
 * Preview of a file that already lives in private storage. Images render in
 * place; a PDF gets an explicit open action, because an inline-disposition
 * signed URL is the only way the browser will show it rather than download it.
 */
function ExistingPreview({
  attachmentId,
  variant,
  mime,
  alt,
}: {
  attachmentId: string;
  variant: { kind: string; revision: number } | null;
  mime: string;
  alt: string;
}) {
  const kind = documentPreview(mime);
  const signedUrl = useQuery({
    queryKey: [
      'attachment-read-url',
      attachmentId,
      variant?.kind ?? null,
      variant?.revision ?? null,
      'inline',
    ],
    queryFn: () => api.get<{ url: string }>(attachmentReadPath(attachmentId, variant, 'inline')),
    staleTime: 20_000,
    retry: 1,
  });

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
  if (kind === 'image') {
    return (
      <img
        src={signedUrl.data.url}
        alt={alt}
        className="max-h-48 max-w-full rounded object-contain"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 p-3 text-center">
      <FileGlyph mime={mime} />
      <a
        href={signedUrl.data.url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-accent underline-offset-2 hover:underline dark:text-teal-400"
      >
        開啟預覽
      </a>
    </div>
  );
}

function FileGlyph({ mime }: { mime: string }) {
  return (
    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
      {mime === 'application/pdf' ? 'PDF 文件' : mime || '檔案'}
    </span>
  );
}

function ReviewStep({
  asset,
  form,
  purchaseForm,
  photoCount,
  docCount,
  addedCount,
  removedCount,
}: {
  asset: HeldAssetListItem;
  form: AssetEditForm;
  purchaseForm: PurchaseEditForm;
  photoCount: number;
  docCount: number;
  addedCount: number;
  removedCount: number;
}) {
  const changes: { label: string; before: string; after: string }[] = [];
  const push = (label: string, before: string, after: string) => {
    if (before.trim() !== after.trim()) {
      changes.push({ label, before: before || '未設定', after: after || '未設定' });
    }
  };

  const labels: Record<OverridableField, string> = {
    name: '商品名稱',
    form: '形式',
    brand: '品牌',
    country: '國家',
    yearOrVersion: '年份／版本',
  };
  for (const field of OVERRIDABLE_FIELDS) {
    push(labels[field], asset[field] ?? '', form[field]);
  }
  push('數量', String(asset.quantity), form.quantity);
  push(
    '單件重量',
    formatGrams(asset.unitWeightGrams, 'g'),
    `${form.unitWeight} ${form.weightUnit}`,
  );
  push('純度', asset.purity, form.purity);
  push(
    '分攤成本',
    formatMoney(asset.allocatedCost, asset.currency),
    formatMoney(form.allocatedCost || '0', asset.currency),
  );
  push('序號', asset.serial ?? '', form.serial);
  push('存放位置', asset.storageLocation ?? '', form.storageLocation);
  push('包裝狀態', asset.packagingState ?? '', form.packagingState);
  if (asset.hasCertificate !== form.hasCertificate) {
    push('附有證書', asset.hasCertificate ? '是' : '否', form.hasCertificate ? '是' : '否');
  }

  push('幣別', asset.currency, form.currency.trim().toUpperCase());

  const original = initialPurchaseForm(asset);
  const purchaseLabels: Record<keyof PurchaseEditForm, string> = {
    dealerName: '交易商',
    branch: '分店／櫃點',
    orderNumber: '訂單編號',
    invoiceNumber: '發票號碼',
    paymentMethod: '付款方式',
    notes: '備註',
  };
  for (const key of Object.keys(purchaseLabels) as (keyof PurchaseEditForm)[]) {
    push(purchaseLabels[key], original[key], purchaseForm[key]);
  }

  const nothingChanged = changes.length === 0 && addedCount === 0 && removedCount === 0;

  return (
    <section className="space-y-4">
      {nothingChanged ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          未做任何變更。
        </p>
      ) : (
        <div className="space-y-3">
          {changes.length > 0 && (
            <div className="surface rounded-xl p-4">
              <h3 className="mb-3 font-medium">欄位變更</h3>
              <ul className="space-y-2 text-sm">
                {changes.map((change) => (
                  <li key={change.label} className="grid gap-0.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {change.label}
                    </span>
                    <span className="break-words [overflow-wrap:anywhere]">
                      <span className="text-slate-500 line-through">{change.before}</span>
                      <span aria-hidden="true"> → </span>
                      <span className="font-medium text-accent dark:text-teal-400">
                        {change.after}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="surface rounded-xl p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <InfoItem label="照片" value={`${photoCount} 張`} />
              <InfoItem label="文件" value={`${docCount} 份`} />
              <InfoItem label="本次新增檔案" value={`${addedCount} 個`} />
              <InfoItem label="本次移除檔案" value={`${removedCount} 個`} />
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  min,
  max,
  step,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: 'decimal' | 'numeric';
  min?: string;
  max?: string;
  step?: string;
  maxLength?: number;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="w-full rounded-lg border px-2 py-1.5"
        type={type}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
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

function toExistingPhotos(data: AssetAttachment[] | undefined): ExistingPhoto[] {
  return (data ?? [])
    .filter((item) => item.mediaClass === 'ASSET_PHOTO' && item.status !== 'FAILED')
    .map((item) => ({
      id: item.id,
      version: item.version,
      kind: item.kind,
      description: item.description ?? '',
      isCover: item.isCover,
      filename: item.filename,
      mime: item.mime,
      variant: previewVariant(item, ['CROPPED', 'THUMBNAIL', 'ORIGINAL']),
    }));
}

function toExistingDocuments(data: AssetAttachment[] | undefined): ExistingDocument[] {
  return (data ?? [])
    .filter((item) => item.mediaClass === 'DOCUMENT' && item.status !== 'FAILED')
    .map((item) => ({
      id: item.id,
      version: item.version,
      kind: item.kind,
      description: item.description ?? '',
      isCover: false,
      filename: item.filename,
      mime: item.mime,
      sizeBytes: item.sizeBytes,
      purchaseScoped: isPurchaseScoped(item),
      variant: previewVariant(item, ['SCAN_COLOR', 'CROPPED', 'THUMBNAIL', 'ORIGINAL']),
    }));
}

/** Uploads one picked file, its derivative if any, then confirms the review. */
async function uploadAssetMedia(
  assetId: string,
  media: NewMedia,
  mediaClass: 'ASSET_PHOTO' | 'DOCUMENT',
): Promise<void> {
  const isPhoto = mediaClass === 'ASSET_PHOTO';
  const processingMode = isPhoto
    ? 'OBJECT_CROP'
    : media.mime === 'application/pdf'
      ? 'NONE'
      : 'DOCUMENT_SCAN';

  const params = new URLSearchParams({
    clientMediaId: media.id,
    kind: media.kind || (isPhoto ? 'asset' : 'document'),
    mediaClass,
    captureSource: media.source,
    processingMode,
  });
  if (media.description.trim()) params.set('description', media.description.trim());
  if (isPhoto && media.isCover) params.set('isCover', 'true');

  const attachment = await api.upload<AssetAttachment>(
    `/assets/${encodeURIComponent(assetId)}/attachments/upload?${params.toString()}`,
    media.originalFile,
    {
      'Content-Type': media.mime,
      'X-Filename': encodeUploadFilename(media.filename),
      'Idempotency-Key': `${assetId}-${media.id}-upload`,
    },
  );

  const processingMetadata: Record<string, unknown> = {
    clientMediaId: media.id,
    originalFilename: media.filename,
    sourceWidth: media.width,
    sourceHeight: media.height,
    transformVersion: 1,
  };

  let version = attachment.version;
  if (isPhoto && media.crop && media.mime.startsWith('image/')) {
    processingMetadata.crop = media.crop;
    const cropped = await renderCroppedPhoto(media.originalFile, media.crop);
    const variant = await api.upload<UploadedVariant>(
      `/attachments/${encodeURIComponent(attachment.id)}/variants/upload?kind=CROPPED`,
      cropped,
      { 'Content-Type': cropped.type },
    );
    version = variant.attachmentVersion;
  } else if (!isPhoto && media.corners && media.mime.startsWith('image/')) {
    processingMetadata.corners = [
      media.corners.topLeft,
      media.corners.topRight,
      media.corners.bottomRight,
      media.corners.bottomLeft,
    ];
    const scan = await renderDocumentScan(media.originalFile, media.corners);
    const variant = await api.upload<UploadedVariant>(
      `/attachments/${encodeURIComponent(attachment.id)}/variants/upload?kind=SCAN_COLOR`,
      scan,
      { 'Content-Type': scan.type },
    );
    version = variant.attachmentVersion;
  }

  await api.patch(`/attachments/${encodeURIComponent(attachment.id)}/review`, {
    version,
    kind: media.kind || (isPhoto ? 'asset' : 'document'),
    mediaClass,
    processingMode,
    processingMetadata,
    userConfirmed: true,
    description: media.description.trim() || null,
    ...(isPhoto ? { isCover: media.isCover } : {}),
  });
}

function encodeUploadFilename(filename: string): string {
  return `UTF-8''${encodeURIComponent(filename)}`;
}
