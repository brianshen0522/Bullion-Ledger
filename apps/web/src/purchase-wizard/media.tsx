import { useEffect, useId, useRef, useState } from 'react';

import { CustomSelect } from '../CustomSelect.js';
import { detectDocumentCorners, detectObjectCrop, pixelsFromImage } from './auto-detection.js';
import { canDecodeWizardImage } from './media-processing.js';
import {
  normalizePrimaryWizardPhotos,
  retargetWizardPhoto,
  setPrimaryWizardPhoto,
} from './model.js';

import {
  DEFAULT_CROP_RECT,
  DEFAULT_DOCUMENT_CORNERS,
  cropHandlePoint,
  createWizardMedia,
  inferMediaMime,
  moveCropHandle,
  moveDocumentCorner,
  replaceWizardMediaFile,
  renderPerspectiveCorrection,
  revokeWizardMediaPreview,
  setCropHandle,
  setDocumentCorner,
  type CropHandle,
  type DocumentCorner,
} from './media-utils.js';
import { MAX_WIZARD_MEDIA_PER_KIND } from './types.js';
import type {
  DocumentCorners,
  NormalizedCropRect,
  NormalizedPoint,
  WizardItem,
  WizardMedia,
  WizardMediaKind,
  WizardMediaSource,
} from './types.js';

const CROP_HANDLES: CropHandle[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const DOCUMENT_CORNERS: DocumentCorner[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const WIZARD_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const HANDLE_LABELS: Record<CropHandle | DocumentCorner, string> = {
  topLeft: '左上角',
  topRight: '右上角',
  bottomRight: '右下角',
  bottomLeft: '左下角',
};

const PHOTO_TYPES = [
  ['front', '正面'],
  ['back', '背面'],
  ['side', '側面／幣邊'],
  ['serial', '序號'],
  ['security', '防偽標誌'],
  ['packaging', '包裝'],
  ['invoice', '發票'],
  ['warranty_card', '保卡'],
] as const;

const DOCUMENT_TYPES = [
  ['invoice', '發票'],
  ['receipt', '收據'],
  ['certificate', '證書'],
  ['warranty_card', '保卡'],
  ['order', '訂單'],
  ['transfer', '匯款證明'],
  ['appraisal', '鑑定文件'],
  ['other', '其他'],
] as const;

const PHOTO_TYPE_OPTIONS = PHOTO_TYPES.map(([value, label]) => ({ value, label }));
const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPES.map(([value, label]) => ({ value, label }));

interface MediaPickerProps {
  kind: WizardMediaKind;
  remainingSlots: number;
  onFiles: (files: File[], source: WizardMediaSource) => void;
}

function MediaPicker({ kind, remainingSlots, onFiles }: MediaPickerProps) {
  const id = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const accepts =
    kind === 'DOCUMENT'
      ? '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'
      : '.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif';

  async function acceptFiles(input: HTMLInputElement, source: WizardMediaSource) {
    const selectedFiles = Array.from(input.files ?? []);
    input.value = '';
    const files = selectedFiles.slice(0, Math.max(0, remainingSlots));
    const overflowCount = selectedFiles.length - files.length;
    const accepted: File[] = [];
    const rejected: string[] = [];
    const undecodable: string[] = [];
    for (const file of files) {
      const mime = inferMediaMime(file.name, file.type);
      const validMime =
        WIZARD_IMAGE_MIMES.has(mime) || (kind === 'DOCUMENT' && mime === 'application/pdf');
      const maximumBytes = mime === 'application/pdf' ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
      if (!validMime || file.size > maximumBytes) rejected.push(file.name || '未命名檔案');
      else if (mime !== 'application/pdf' && !(await canDecodeWizardImage(file))) {
        undecodable.push(file.name || '未命名檔案');
      } else accepted.push(file);
    }
    const errors = [
      rejected.length
        ? `未加入 ${rejected.join('、')}；格式不支援或檔案過大。圖片上限 25 MB、PDF 上限 50 MB。`
        : '',
      undecodable.length
        ? `此瀏覽器無法解碼 ${undecodable.join('、')}，請改用 JPEG、PNG 或 WebP；iPhone 可先以「最相容」格式拍攝或匯出。`
        : '',
      overflowCount > 0
        ? `每個步驟最多保留 ${MAX_WIZARD_MEDIA_PER_KIND} 個附件，另有 ${overflowCount} 個未加入。`
        : '',
    ].filter(Boolean);
    setSelectionError(errors.length ? errors.join(' ') : null);
    if (accepted.length) onFiles(accepted, source);
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="新增附件">
      <input
        ref={cameraRef}
        id={`${id}-camera`}
        className="sr-only"
        type="file"
        disabled={remainingSlots <= 0}
        accept="image/*"
        capture="environment"
        multiple
        onChange={(event) => void acceptFiles(event.currentTarget, 'CAMERA')}
      />
      <button
        type="button"
        disabled={remainingSlots <= 0}
        className="rounded-xl border border-teal-700 bg-teal-700 px-4 py-3 font-medium text-white shadow-sm hover:bg-teal-800 dark:border-teal-500 dark:bg-teal-600 dark:hover:bg-teal-500"
        onClick={() => cameraRef.current?.click()}
      >
        <span aria-hidden="true">📷 </span>直接拍照（可多張）
      </button>
      <input
        ref={libraryRef}
        id={`${id}-library`}
        className="sr-only"
        type="file"
        disabled={remainingSlots <= 0}
        accept={accepts}
        multiple
        onChange={(event) => void acceptFiles(event.currentTarget, 'LIBRARY')}
      />
      <button
        type="button"
        disabled={remainingSlots <= 0}
        className="surface rounded-xl px-4 py-3 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
        onClick={() => libraryRef.current?.click()}
      >
        <span aria-hidden="true">▧ </span>從圖片庫／檔案選擇
      </button>
      {selectionError && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {selectionError}
        </p>
      )}
    </div>
  );
}

interface ProductPhotosStepProps {
  items: readonly WizardItem[];
  photos: readonly WizardMedia[];
  onChange: (photos: WizardMedia[]) => void;
}

export function ProductPhotosStep({ items, photos, onChange }: ProductPhotosStepProps) {
  const defaultTarget = items[0]?.id;

  function patch(id: string, next: Partial<WizardMedia>) {
    onChange(photos.map((photo) => (photo.id === id ? { ...photo, ...next } : photo)));
  }

  return (
    <section aria-labelledby="wizard-photo-heading" className="space-y-4">
      <div>
        <h2 id="wizard-photo-heading" className="text-xl font-semibold">
          商品照片
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          金條建議拍正面、背面、序號與包裝；金幣建議拍正反面與幣邊。系統只保存裁切範圍，原始照片不會被覆蓋。
        </p>
        <p className="mt-1 text-sm font-medium text-teal-700 dark:text-teal-300">
          可連續拍攝或一次選取多張，並為每項商品指定一張主要照片。
        </p>
      </div>
      <MediaPicker
        kind="ASSET_PHOTO"
        remainingSlots={MAX_WIZARD_MEDIA_PER_KIND - photos.length}
        onFiles={(files, source) =>
          onChange(
            normalizePrimaryWizardPhotos([
              ...photos,
              ...files.map((file) =>
                createWizardMedia(file, 'ASSET_PHOTO', source, { targetItemId: defaultTarget }),
              ),
            ]),
          )
        }
      />
      {photos.length === 0 ? (
        <EmptyAttachmentNotice label="尚未加入商品照片，可先略過並在確認頁看到缺漏提醒。" />
      ) : (
        <ul className="grid min-w-0 gap-4 lg:grid-cols-2" aria-label="商品照片">
          {photos.map((photo) => (
            <li key={photo.id} className="surface min-w-0 space-y-3 rounded-xl p-3">
              <MediaPreview media={photo} editor="crop" onPatch={(next) => patch(photo.id, next)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <CustomSelect
                  label="對應商品"
                  value={photo.targetItemId ?? ''}
                  onChange={(targetItemId) =>
                    onChange(retargetWizardPhoto(photos, photo.id, targetItemId || undefined))
                  }
                  options={[
                    { value: '', label: '整筆交易' },
                    ...items.map((item, index) => ({
                      value: item.id,
                      label: `${index + 1}. ${item.name || '未命名商品'}`,
                    })),
                  ]}
                />
                <CustomSelect
                  label="照片類型"
                  value={photo.attachmentType ?? 'front'}
                  onChange={(attachmentType) => patch(photo.id, { attachmentType })}
                  options={PHOTO_TYPE_OPTIONS}
                />
              </div>
              <label
                className={
                  photo.isPrimary
                    ? 'flex min-h-11 items-center gap-3 rounded-lg border border-teal-600 bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-100'
                    : 'flex min-h-11 items-center gap-3 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600'
                }
              >
                <input
                  type="radio"
                  className="h-5 min-h-0 w-5"
                  name={`primary-photo-${photo.targetItemId ?? 'purchase'}`}
                  checked={photo.isPrimary === true}
                  onChange={() => onChange(setPrimaryWizardPhoto(photos, photo.id))}
                />
                <span className="font-medium">
                  {photo.isPrimary ? '主要照片（將顯示於持有庫存）' : '設為主要照片'}
                </span>
              </label>
              <MediaMetadataFields media={photo} onPatch={(next) => patch(photo.id, next)} />
              <RemoveMediaButton
                label={`移除照片 ${photo.filename}`}
                onRemove={() => {
                  revokeWizardMediaPreview(photo);
                  onChange(
                    normalizePrimaryWizardPhotos(photos.filter(({ id }) => id !== photo.id)),
                  );
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface DocumentsStepProps {
  documents: readonly WizardMedia[];
  onChange: (documents: WizardMedia[]) => void;
}

export function DocumentsStep({ documents, onChange }: DocumentsStepProps) {
  function patch(id: string, next: Partial<WizardMedia>) {
    onChange(
      documents.map((document) => (document.id === id ? { ...document, ...next } : document)),
    );
  }

  return (
    <section aria-labelledby="wizard-document-heading" className="space-y-4">
      <div>
        <h2 id="wizard-document-heading" className="text-xl font-semibold">
          文件掃描與歸檔
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          可拍攝發票、收據與證書，或從檔案選擇
          PDF。拖曳四角把文件框出來；這只建立可重做的校正參數，原檔仍完整保留。
        </p>
      </div>
      <MediaPicker
        kind="DOCUMENT"
        remainingSlots={MAX_WIZARD_MEDIA_PER_KIND - documents.length}
        onFiles={(files, source) =>
          onChange(
            files
              .map((file) => createWizardMedia(file, 'DOCUMENT', source))
              .reduce((all, media) => [...all, media], [...documents]),
          )
        }
      />
      {documents.length === 0 ? (
        <EmptyAttachmentNotice label="尚未加入文件；仍可入庫，確認頁會標示文件待補。" />
      ) : (
        <ol className="space-y-4" aria-label="文件頁面">
          {documents.map((document, index) => (
            <li key={document.id} className="surface min-w-0 space-y-3 rounded-xl p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">文件 {index + 1}</h3>
                <div className="flex gap-1">
                  <OrderButton
                    label="上移文件"
                    disabled={index === 0}
                    onClick={() => onChange(moveMedia(documents, index, -1))}
                  >
                    ↑
                  </OrderButton>
                  <OrderButton
                    label="下移文件"
                    disabled={index === documents.length - 1}
                    onClick={() => onChange(moveMedia(documents, index, 1))}
                  >
                    ↓
                  </OrderButton>
                </div>
              </div>
              <MediaPreview
                media={document}
                editor="document"
                onPatch={(next) => patch(document.id, next)}
              />
              <CustomSelect
                label="文件類型"
                value={document.documentType ?? 'invoice'}
                onChange={(documentType) => patch(document.id, { documentType })}
                options={DOCUMENT_TYPE_OPTIONS}
              />
              <MediaMetadataFields media={document} onPatch={(next) => patch(document.id, next)} />
              <RemoveMediaButton
                label={`移除文件 ${document.filename}`}
                onRemove={() => {
                  revokeWizardMediaPreview(document);
                  onChange(documents.filter(({ id }) => id !== document.id));
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function moveMedia(media: readonly WizardMedia[], index: number, direction: -1 | 1): WizardMedia[] {
  const to = index + direction;
  if (to < 0 || to >= media.length) return [...media];
  const next = [...media];
  const [entry] = next.splice(index, 1);
  next.splice(to, 0, entry!);
  return next;
}

function MediaMetadataFields({
  media,
  onPatch,
}: {
  media: WizardMedia;
  onPatch: (next: Partial<WizardMedia>) => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">說明（選填）</span>
      <input
        className="w-full rounded-lg border px-3 py-2"
        value={media.description ?? ''}
        maxLength={200}
        placeholder="例如：序號近照、購買收據第 2 頁"
        onChange={(event) => onPatch({ description: event.target.value })}
      />
    </label>
  );
}

function MediaPreview({
  media,
  editor,
  onPatch,
}: {
  media: WizardMedia;
  editor: 'crop' | 'document';
  onPatch: (next: Partial<WizardMedia>) => void;
}) {
  if (media.needsReselection || !media.previewUrl) {
    if (media.serverAttachmentStatus === 'READY') {
      return (
        <div className="rounded-lg border border-teal-300 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100">
          <p className="font-medium">原檔與處理版本已安全歸檔</p>
          <p className="mt-1 break-words">
            {media.filename} 已在系統完成處理；如要重新裁切或校正，請重新選擇原檔。
          </p>
          <ReselectMediaButton media={media} onPatch={onPatch} label="重新選擇並處理" />
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <p className="font-medium">
          {media.serverAttachmentStatus ? '附件處理尚未完成' : '需要重新選擇原檔'}
        </p>
        <p className="mt-1 break-words">
          {media.filename} 的中繼資料與調整參數已續存；瀏覽器基於隱私不會把本機原檔放進
          localStorage。
        </p>
        <ReselectMediaButton media={media} onPatch={onPatch} label="重新選擇原檔" />
      </div>
    );
  }
  if (!media.mime.startsWith('image/')) {
    return (
      <div className="rounded-lg border border-slate-300 p-4 text-sm dark:border-slate-600">
        <p className="font-medium">PDF 文件</p>
        <p className="mt-1 break-words text-slate-500 dark:text-slate-400">{media.filename}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {editor === 'crop' ? (
        <CropEditor
          src={media.previewUrl}
          filename={media.filename}
          crop={media.crop ?? DEFAULT_CROP_RECT}
          onChange={(crop) => onPatch({ crop })}
          onDimensions={(width, height) => onPatch({ width, height })}
        />
      ) : (
        <DocumentCornerEditor
          src={media.previewUrl}
          filename={media.filename}
          corners={media.documentCorners ?? DEFAULT_DOCUMENT_CORNERS}
          onChange={(documentCorners) => onPatch({ documentCorners })}
          onDimensions={(width, height) => onPatch({ width, height })}
        />
      )}
      <p className="break-words text-xs text-slate-500 dark:text-slate-400">
        原檔：{media.filename} · {formatBytes(media.sizeBytes)} ·{' '}
        {media.source === 'CAMERA' ? '相機' : '圖片庫／檔案'}
      </p>
    </div>
  );
}

function ReselectMediaButton({
  media,
  onPatch,
  label,
}: {
  media: WizardMedia;
  onPatch: (next: Partial<WizardMedia>) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const accepts =
    media.kind === 'DOCUMENT'
      ? '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'
      : '.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif';

  async function acceptReplacement(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const mime = inferMediaMime(file.name, file.type);
    const valid =
      WIZARD_IMAGE_MIMES.has(mime) || (media.kind === 'DOCUMENT' && mime === 'application/pdf');
    const maximum = mime === 'application/pdf' ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
    if (!valid || file.size > maximum) {
      setError('檔案格式或大小不符合上傳限制。');
      return;
    }
    if (mime !== 'application/pdf' && !(await canDecodeWizardImage(file))) {
      setError('此瀏覽器無法解碼這張圖片，請改用 JPEG、PNG 或 WebP。');
      return;
    }
    const replacement = replaceWizardMediaFile(media, file, 'LIBRARY');
    revokeWizardMediaPreview(media);
    setError(null);
    onPatch(replacement);
  }

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={accepts}
        onChange={(event) => void acceptReplacement(event.currentTarget)}
      />
      <button
        type="button"
        className="mt-1 rounded-lg border border-current px-3 text-sm font-medium"
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function CropEditor({
  src,
  filename,
  crop,
  onChange,
  onDimensions,
}: {
  src: string;
  filename: string;
  crop: NormalizedCropRect;
  onChange: (crop: NormalizedCropRect) => void;
  onDimensions?: (width: number, height: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const autoDetectedSource = useRef<string | null>(null);
  const [detectionMessage, setDetectionMessage] = useState('');

  useEffect(() => {
    autoDetectedSource.current = null;
    setDetectionMessage('');
  }, [src]);

  async function autoDetect(image = imageRef.current) {
    if (!image) return;
    setDetectionMessage('正在裝置上偵測商品範圍…');
    await nextPaint();
    try {
      const result = detectObjectCrop(pixelsFromImage(image));
      if (!result) {
        setDetectionMessage('未能可靠辨識主體，請手動調整四個控制點。');
        return;
      }
      onChange(result.value);
      setDetectionMessage(
        `已自動框選（信心 ${formatConfidence(result.confidence)}），請確認邊界。`,
      );
    } catch (error) {
      setDetectionMessage(error instanceof Error ? error.message : '自動框選失敗，請手動調整。');
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">調整商品裁切範圍</p>
        <button
          type="button"
          className="interactive-muted rounded-lg px-3 text-sm font-medium"
          onClick={() => void autoDetect()}
        >
          重新自動框選
        </button>
      </div>
      <div
        ref={containerRef}
        className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-slate-950 touch-none select-none"
      >
        <img
          ref={imageRef}
          src={src}
          alt={`${filename} 原始照片預覽`}
          className="block max-h-[32rem] w-auto max-w-full object-contain"
          draggable={false}
          onLoad={(event) => {
            onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
            if (autoDetectedSource.current !== src) {
              autoDetectedSource.current = src;
              void autoDetect(event.currentTarget);
            }
          }}
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <rect
            x={`${crop.x * 100}%`}
            y={`${crop.y * 100}%`}
            width={`${crop.width * 100}%`}
            height={`${crop.height * 100}%`}
            fill="none"
            stroke="#2dd4bf"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {CROP_HANDLES.map((handle) => {
          const point = cropHandlePoint(crop, handle);
          return (
            <DragHandle
              key={handle}
              label={`調整裁切${HANDLE_LABELS[handle]}`}
              point={point}
              containerRef={containerRef}
              onPoint={(nextPoint) => onChange(setCropHandle(crop, handle, nextPoint))}
              onKeyboard={(deltaX, deltaY) =>
                onChange(moveCropHandle(crop, handle, deltaX, deltaY))
              }
            />
          );
        })}
      </div>
      {detectionMessage && (
        <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          {detectionMessage}
        </p>
      )}
      <EditorHelp />
    </div>
  );
}

export function DocumentCornerEditor({
  src,
  filename,
  corners,
  onChange,
  onDimensions,
}: {
  src: string;
  filename: string;
  corners: DocumentCorners;
  onChange: (corners: DocumentCorners) => void;
  onDimensions?: (width: number, height: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const autoDetectedSource = useRef<string | null>(null);
  const [detectionMessage, setDetectionMessage] = useState('');
  const [correctedPreview, setCorrectedPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    autoDetectedSource.current = null;
    setDetectionMessage('');
    setCorrectedPreview(null);
    setPreviewError(null);
  }, [src]);

  function changeCorners(next: DocumentCorners) {
    setCorrectedPreview(null);
    setPreviewError(null);
    onChange(next);
  }

  async function autoDetect(image = imageRef.current) {
    if (!image) return;
    setDetectionMessage('正在裝置上偵測文件四角…');
    await nextPaint();
    try {
      const result = detectDocumentCorners(pixelsFromImage(image));
      if (!result) {
        setDetectionMessage('未能可靠辨識文件邊界，請手動移動四角。');
        return;
      }
      changeCorners(result.value);
      setDetectionMessage(
        `已自動找到四角（信心 ${formatConfidence(result.confidence)}），請確認後預覽拉正。`,
      );
    } catch (error) {
      setDetectionMessage(error instanceof Error ? error.message : '文件邊界偵測失敗。');
    }
  }

  async function previewCorrection() {
    if (!imageRef.current) return;
    setPreviewError(null);
    await nextPaint();
    try {
      setCorrectedPreview(createCorrectedDocumentPreview(imageRef.current, corners));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '無法產生拉正預覽。');
    }
  }

  const polygon = DOCUMENT_CORNERS.map((corner) => {
    const point = corners[corner];
    return `${point.x * 100},${point.y * 100}`;
  }).join(' ');
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">框選文件四角</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="interactive-muted rounded-lg px-3 text-sm font-medium"
            onClick={() => void autoDetect()}
          >
            重新偵測四角
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 text-sm font-medium text-white"
            onClick={() => void previewCorrection()}
          >
            預覽拉正
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-slate-950 touch-none select-none"
      >
        <img
          ref={imageRef}
          src={src}
          alt={`${filename} 原始文件預覽`}
          className="block max-h-[36rem] w-auto max-w-full object-contain"
          draggable={false}
          onLoad={(event) => {
            onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
            if (autoDetectedSource.current !== src) {
              autoDetectedSource.current = src;
              void autoDetect(event.currentTarget);
            }
          }}
        />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            points={polygon}
            fill="rgba(13,148,136,0.15)"
            stroke="#2dd4bf"
            strokeWidth="0.8"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {DOCUMENT_CORNERS.map((corner) => (
          <DragHandle
            key={corner}
            label={`調整文件${HANDLE_LABELS[corner]}`}
            point={corners[corner]}
            containerRef={containerRef}
            onPoint={(point) => changeCorners(setDocumentCorner(corners, corner, point))}
            onKeyboard={(deltaX, deltaY) =>
              changeCorners(moveDocumentCorner(corners, corner, deltaX, deltaY))
            }
          />
        ))}
      </div>
      {detectionMessage && (
        <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          {detectionMessage}
        </p>
      )}
      {previewError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {previewError}
        </p>
      )}
      {correctedPreview && (
        <figure className="mt-3 rounded-lg border border-teal-300 bg-slate-100 p-2 dark:border-teal-800 dark:bg-slate-900">
          <img
            src={correctedPreview}
            alt={`${filename} 透視拉正預覽`}
            className="mx-auto max-h-[36rem] max-w-full rounded object-contain"
          />
          <figcaption className="mt-2 text-xs text-slate-600 dark:text-slate-300">
            拉正預覽；歸檔仍會保留原始檔與四角參數，可隨時重新處理。
          </figcaption>
        </figure>
      )}
      <EditorHelp />
    </div>
  );
}

function DragHandle({
  label,
  point,
  containerRef,
  onPoint,
  onKeyboard,
}: {
  label: string;
  point: NormalizedPoint;
  containerRef: React.RefObject<HTMLDivElement>;
  onPoint: (point: NormalizedPoint) => void;
  onKeyboard: (deltaX: number, deltaY: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="absolute z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full bg-transparent focus-visible:ring-offset-slate-950"
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        onPoint({
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        });
      }}
      onKeyDown={(event) => {
        const amount = event.shiftKey ? 0.05 : 0.01;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-amount, 0],
          ArrowRight: [amount, 0],
          ArrowUp: [0, -amount],
          ArrowDown: [0, amount],
        };
        const movement = delta[event.key];
        if (!movement) return;
        event.preventDefault();
        onKeyboard(movement[0], movement[1]);
      }}
    >
      <span
        className="h-4 w-4 rounded-full border-2 border-white bg-teal-500 shadow"
        aria-hidden="true"
      />
    </button>
  );
}

function EditorHelp() {
  return (
    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
      拖曳控制點；鍵盤可用方向鍵微調，Shift＋方向鍵加速。裁切／校正可隨時重做。
    </p>
  );
}

function EmptyAttachmentNotice({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
      {label}
    </div>
  );
}

function RemoveMediaButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="rounded-lg px-3 text-sm font-medium text-danger underline-offset-4 hover:bg-red-50 hover:underline dark:hover:bg-red-950"
      onClick={onRemove}
    >
      {label}
    </button>
  );
}

function OrderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="interactive-muted h-11 w-11 rounded-lg disabled:opacity-30"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else globalThis.setTimeout(resolve, 0);
  });
}

function createCorrectedDocumentPreview(image: HTMLImageElement, corners: DocumentCorners): string {
  const maxSourceSide = 1800;
  const scale = Math.min(1, maxSourceSide / Math.max(image.naturalWidth, image.naturalHeight));
  const source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(image.naturalWidth * scale));
  source.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = source.getContext('2d');
  if (!context) throw new Error('瀏覽器無法建立文件預覽。');
  context.drawImage(image, 0, 0, source.width, source.height);
  return renderPerspectiveCorrection(source, corners, 1200).toDataURL('image/jpeg', 0.9);
}
