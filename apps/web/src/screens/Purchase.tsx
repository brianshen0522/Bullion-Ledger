import { isWeightUnit } from '@bullion-ledger/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, isApiError, type Metal, type ProductDefinition, type PurchaseListItem } from '../api.js';
import { searchOrganizationCatalog } from '../organization-search-provider.js';
import {
  PurchaseWizard,
  attachmentKind,
  buildAttachmentReviewPayload,
  loadPurchaseWizardDraft,
  normalizePrimaryWizardPhotos,
  parsePurchaseWizardDraft,
  PURCHASE_WIZARD_STORAGE_KEY,
  renderCroppedPhoto,
  renderDocumentScan,
  serializePurchaseWizardDraft,
  wizardStepIndex,
  type PurchaseWizardDraft,
  type WizardMedia,
  type WizardProduct,
  type WizardPurchasePayload,
} from '../purchase-wizard/index.js';
import {
  completedIntakeForDraft,
  continueFinalizeOrRecover,
  evictCompletedIntakeQueries,
  recoveredPurchaseResult,
} from './purchase-intake-recovery.js';

export interface PurchaseIntake {
  id: string;
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  currentStep: number;
  schemaVersion: number;
  version: number;
  updatedAt: string;
  draftData: Record<string, unknown>;
  completedPurchaseId?: string | null;
  attachments: IntakeAttachment[];
}

interface IntakeAttachment {
  id: string;
  version: number;
  kind: string;
  mediaClass: 'ASSET_PHOTO' | 'DOCUMENT';
  status: 'READY' | 'NEEDS_REVIEW' | 'PROCESSING' | 'FAILED';
  processingMetadata?: Record<string, unknown> | null;
  variants?: { kind: string; revision: number }[];
}

interface IntakeReference {
  id: string;
  version: number;
}

interface UploadedMediaReference {
  id: string;
  version: number;
  status: IntakeAttachment['status'];
  variantKinds: Set<string>;
}

interface UploadedAttachmentVariant {
  kind: string;
  revision: number;
  attachmentVersion: number;
}

export function PurchaseScreen({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const intake = useRef<IntakeReference | null>(null);
  const completedIntake = useRef<PurchaseIntake | null>(null);
  const uploadedMedia = useRef(new Map<string, UploadedMediaReference>());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const hydrationDone = useRef(false);
  const completionAcknowledged = useRef(false);
  const screenDone = useRef(false);
  const [recoveredCompletion, setRecoveredCompletion] = useState<PurchaseIntake | null>(null);
  const localDraft = useMemo(loadLocalDraft, []);

  const finishScreen = useCallback(() => {
    if (screenDone.current) return;
    screenDone.current = true;
    onDone();
  }, [onDone]);

  const rememberCompletedIntake = useCallback((completed: PurchaseIntake) => {
    completedIntake.current = completed;
    setRecoveredCompletion(completed);
  }, []);

  const metals = useQuery<Metal[]>({
    queryKey: ['metals'],
    queryFn: () => api.get<Metal[]>('/metals'),
  });
  const products = useQuery<ProductDefinition[]>({
    queryKey: ['products'],
    queryFn: () => api.get<ProductDefinition[]>('/product-definitions'),
  });
  const systemDrafts = useQuery<PurchaseIntake[]>({
    queryKey: ['purchase-intakes', 'DRAFT'],
    queryFn: () => api.get<PurchaseIntake[]>('/purchase-intakes?status=DRAFT'),
    retry: false,
  });
  const matchingLocalIntake = useQuery<PurchaseIntake>({
    queryKey: ['purchase-intake', localDraft?.draftId],
    queryFn: () =>
      api.get<PurchaseIntake>(`/purchase-intakes/${encodeURIComponent(localDraft!.draftId)}`),
    enabled: Boolean(localDraft),
    retry: false,
  });

  const exactDraftIntake = matchingLocalIntake.data;
  const recoveredOnLoad = completedIntakeForDraft(localDraft?.draftId, exactDraftIntake);
  const completionToAcknowledge = recoveredOnLoad ?? recoveredCompletion;
  useEffect(() => {
    if (!completionToAcknowledge || completionAcknowledged.current) return;
    completionAcknowledged.current = true;
    clearLocalDraft();
    evictCompletedIntakeQueries(queryClient, completionToAcknowledge.id);
    void queryClient.invalidateQueries({ queryKey: ['purchase-intakes', 'DRAFT'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['purchases'] });
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
    finishScreen();
  }, [completionToAcknowledge, finishScreen, queryClient]);

  const availableDrafts = useMemo(() => {
    const drafts = systemDrafts.data ?? [];
    if (
      exactDraftIntake?.status !== 'DRAFT' ||
      drafts.some(({ id }) => id === exactDraftIntake.id)
    ) {
      return drafts;
    }
    return [...drafts, exactDraftIntake];
  }, [exactDraftIntake, systemDrafts.data]);

  const initialSelection = useMemo(
    () => selectInitialDraft(availableDrafts, localDraft),
    [availableDrafts, localDraft],
  );
  const localIntakeLookupPending = Boolean(localDraft) && matchingLocalIntake.isPending;
  if (!hydrationDone.current && !systemDrafts.isPending && !localIntakeLookupPending) {
    hydrationDone.current = true;
    if (initialSelection.intake) {
      intake.current = {
        id: initialSelection.intake.id,
        version: initialSelection.intake.version,
      };
      hydrateUploadedMedia(initialSelection.intake.attachments, uploadedMedia.current);
    }
  }

  const wizardProducts = useMemo(
    () => (products.data ?? []).filter((product) => product.active !== false).map(toWizardProduct),
    [products.data],
  );

  const synchronizeDraft = useCallback(
    (draft: PurchaseWizardDraft): Promise<void> => {
      const operation = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (completedIntake.current && completedIntake.current.id !== draft.draftId) {
            completedIntake.current = null;
          }
          if (intake.current && intake.current.id !== draft.draftId) {
            intake.current = null;
            uploadedMedia.current.clear();
          }
          if (completedIntakeForDraft(draft.draftId, completedIntake.current)) return;
          const draftData = JSON.parse(serializePurchaseWizardDraft(draft)) as Record<
            string,
            unknown
          >;
          const body = {
            currentStep: wizardStepIndex(draft.currentStep),
            schemaVersion: draft.version,
            draftData,
          };

          if (!intake.current) {
            const created = await api.post<PurchaseIntake>('/purchase-intakes', {
              draftId: draft.draftId,
              ...body,
            });
            const recovered = completedIntakeForDraft(draft.draftId, created);
            if (recovered) {
              rememberCompletedIntake(recovered);
              return;
            }
            if (created.status !== 'DRAFT') {
              throw new Error('這份入庫草稿已取消，請重新建立。');
            }
            intake.current = { id: created.id, version: created.version };

            // POST is idempotent and can return an older server copy after a reload.
            // Bring that copy forward with optimistic concurrency before continuing.
            if (draftUpdatedAt(created.draftData) !== draft.updatedAt) {
              const updated = await api.patch<PurchaseIntake>(`/purchase-intakes/${created.id}`, {
                version: created.version,
                ...body,
              });
              intake.current = { id: updated.id, version: updated.version };
            }
            return;
          }

          let updated: PurchaseIntake;
          try {
            updated = await api.patch<PurchaseIntake>(`/purchase-intakes/${intake.current.id}`, {
              version: intake.current.version,
              ...body,
            });
          } catch (error) {
            const recovered = await lookupCompletedIntake(draft.draftId);
            if (recovered) {
              rememberCompletedIntake(recovered);
              intake.current = null;
              return;
            }
            if (isApiError(error) && error.status === 409 && intake.current) {
              const fresh = await api.get<PurchaseIntake>(`/purchase-intakes/${intake.current.id}`);
              if (fresh.status === 'DRAFT') {
                intake.current = { id: fresh.id, version: fresh.version };
                updated = await api.patch<PurchaseIntake>(`/purchase-intakes/${intake.current.id}`, {
                  version: fresh.version,
                  ...body,
                });
              } else {
                throw error;
              }
            } else {
              throw error;
            }
          }
          intake.current = { id: updated.id, version: updated.version };
        });
      saveQueue.current = operation;
      return operation;
    },
    [rememberCompletedIntake],
  );

  const finalize = useCallback(
    async (payload: WizardPurchasePayload, idempotencyKey: string, draft: PurchaseWizardDraft) => {
      await synchronizeDraft(draft);
      const result = await continueFinalizeOrRecover(
        draft.draftId,
        completedIntake.current,
        async () => {
          const currentIntake = intake.current;
          if (!currentIntake) throw new Error('系統草稿尚未建立，請稍後再試。');

          await uploadDraftMedia(currentIntake.id, draft, uploadedMedia.current);
          const purchasePayload = {
            ...payload,
            items: payload.items.map((item, index) => ({
              ...item,
              draftItemId: draft.items[index]?.id,
            })),
          };
          try {
            return await api.post<PurchaseListItem>(
              `/purchase-intakes/${currentIntake.id}/finalize`,
              purchasePayload,
              { headers: { 'Idempotency-Key': idempotencyKey } },
            );
          } catch (error) {
            const recovered = await lookupCompletedIntake(draft.draftId);
            if (!recovered) throw error;
            rememberCompletedIntake(recovered);
            intake.current = null;
            return recoveredPurchaseResult(recovered);
          }
        },
      );
      evictCompletedIntakeQueries(queryClient, draft.draftId);
      void queryClient.invalidateQueries({ queryKey: ['purchase-intakes', 'DRAFT'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['purchases'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      return result;
    },
    [queryClient, rememberCompletedIntake, synchronizeDraft],
  );

  if (
    metals.isPending ||
    products.isPending ||
    systemDrafts.isPending ||
    localIntakeLookupPending ||
    completionToAcknowledge
  ) {
    return <p className="py-8 text-center text-slate-600 dark:text-slate-300">正在載入入庫資料…</p>;
  }
  if (metals.isError) {
    return (
      <LoadError
        label="金屬資料"
        message={metals.error.message}
        retry={() => void metals.refetch()}
      />
    );
  }
  if (products.isError) {
    return (
      <LoadError
        label="商品模板"
        message={products.error.message}
        retry={() => void products.refetch()}
      />
    );
  }
  if (systemDrafts.isError) {
    return (
      <LoadError
        label="系統草稿"
        message={systemDrafts.error.message}
        retry={() => void systemDrafts.refetch()}
      />
    );
  }

  return (
    <PurchaseWizard
      metals={metals.data}
      products={wizardProducts}
      initialDraft={initialSelection.draft}
      searchOrganizations={searchOrganizationCatalog}
      onSystemSave={synchronizeDraft}
      onCatalogConflict={async () => {
        await queryClient.invalidateQueries({ queryKey: ['products'] });
      }}
      onFinalize={finalize}
      onCompleted={finishScreen}
      onCancel={finishScreen}
    />
  );
}

function toWizardProduct(product: ProductDefinition): WizardProduct {
  return {
    id: product.id,
    version: product.version,
    name: product.name,
    metalCode: product.metal.code,
    form: product.form,
    brand: product.brand,
    country: product.country,
    yearOrVersion: product.yearOrVersion,
    defaultPurity: product.defaultPurity,
    defaultUnitWeightGrams: product.defaultUnitWeightGrams,
    defaultWeightUnit: isWeightUnit(product.defaultWeightUnit) ? product.defaultWeightUnit : 'g',
    organizations: product.organizations?.map((party) => ({
      id: `catalog-party-${party.id}`,
      organizationId: party.organization.id,
      displayName: party.organization.canonicalName,
      role: party.role,
      isPrimary: party.isPrimary,
      custom: false,
    })),
  };
}

async function uploadDraftMedia(
  intakeId: string,
  draft: PurchaseWizardDraft,
  uploaded: Map<string, UploadedMediaReference>,
): Promise<void> {
  const allMedia = [...normalizePrimaryWizardPhotos(draft.photos), ...draft.documents];
  const activeMediaIds = new Set(allMedia.map(({ id }) => id));
  for (const [mediaId, reference] of uploaded) {
    if (activeMediaIds.has(mediaId)) continue;
    await api.delete(`/attachments/${reference.id}`);
    uploaded.delete(mediaId);
  }
  for (let index = 0; index < allMedia.length; index += 1) {
    const media = allMedia[index]!;
    let reference = uploaded.get(media.id);
    if (reference && !media.originalFile) {
      if (reference.status !== 'READY') {
        throw new Error(`「${media.filename}」尚未完成處理，請重新選擇原檔。`);
      }
    }
    if (!reference) {
      if (!media.originalFile) {
        throw new Error(`「${media.filename}」需要重新選擇原檔，或先從草稿移除後才能完成入庫。`);
      }
      const parameters = attachmentUploadParameters(media);
      const attachment = await api.upload<IntakeAttachment>(
        `/purchase-intakes/${intakeId}/attachments/upload?${parameters.toString()}`,
        media.originalFile,
        {
          'Content-Type': media.mime,
          'X-Filename': encodeUploadFilename(media.filename),
          'Idempotency-Key': `${draft.draftId}-${media.id}-upload`,
        },
      );
      reference = {
        id: attachment.id,
        version: attachment.version,
        status: attachment.status,
        variantKinds: new Set(attachment.variants?.map(({ kind }) => kind) ?? []),
      };
      uploaded.set(media.id, reference);
    }

    const processed = await processedVariant(media);
    if (processed) {
      const variant = await api.upload<UploadedAttachmentVariant>(
        `/attachments/${reference.id}/variants/upload?kind=${processed.kind}`,
        processed.blob,
        { 'Content-Type': processed.blob.type },
      );
      reference.version = variant.attachmentVersion;
      reference.variantKinds.add(processed.kind);
    }

    const reviewed = await api.patch<IntakeAttachment>(
      `/attachments/${reference.id}/review`,
      buildAttachmentReviewPayload(
        media,
        index,
        reference.version,
        media.originalFile ? mediaProcessingMetadata(media) : undefined,
      ),
    );
    reference.version = reviewed.version;
    reference.status = reviewed.status;
  }
}

async function processedVariant(
  media: WizardMedia,
): Promise<{ kind: 'CROPPED' | 'SCAN_COLOR'; blob: Blob } | null> {
  if (!media.originalFile || media.mime === 'application/pdf') return null;
  if (media.kind === 'ASSET_PHOTO') {
    if (!media.crop) throw new Error(`「${media.filename}」尚未確認商品裁切範圍。`);
    return { kind: 'CROPPED', blob: await renderCroppedPhoto(media.originalFile, media.crop) };
  }
  if (!media.documentCorners) throw new Error(`「${media.filename}」尚未確認文件四角。`);
  return {
    kind: 'SCAN_COLOR',
    blob: await renderDocumentScan(media.originalFile, media.documentCorners),
  };
}

function attachmentUploadParameters(media: WizardMedia): URLSearchParams {
  const parameters = new URLSearchParams({
    clientMediaId: media.id,
    kind: attachmentKind(media),
    mediaClass: media.kind,
    captureSource: media.source,
    processingMode:
      media.kind === 'DOCUMENT'
        ? media.mime === 'application/pdf'
          ? 'NONE'
          : 'DOCUMENT_SCAN'
        : 'OBJECT_CROP',
  });
  if (media.targetItemId) parameters.set('draftItemId', media.targetItemId);
  if (media.description?.trim()) parameters.set('description', media.description.trim());
  if (media.kind === 'ASSET_PHOTO' && media.isPrimary === true) {
    parameters.set('isCover', 'true');
  }
  return parameters;
}

function mediaProcessingMetadata(media: WizardMedia): Record<string, unknown> {
  const corners = media.documentCorners
    ? [
        media.documentCorners.topLeft,
        media.documentCorners.topRight,
        media.documentCorners.bottomRight,
        media.documentCorners.bottomLeft,
      ]
    : undefined;
  return {
    clientMediaId: media.id,
    originalFilename: media.filename,
    sourceWidth: media.width,
    sourceHeight: media.height,
    crop: media.crop,
    corners,
    transformVersion: 1,
  };
}

function encodeUploadFilename(filename: string): string {
  return `UTF-8''${encodeURIComponent(filename)}`;
}

function draftUpdatedAt(draftData: Record<string, unknown>): string | null {
  return typeof draftData.updatedAt === 'string' ? draftData.updatedAt : null;
}

export function selectInitialDraft(
  systemDrafts: PurchaseIntake[],
  local: PurchaseWizardDraft | null,
): {
  draft?: PurchaseWizardDraft;
  intake?: PurchaseIntake;
} {
  const candidates = new Map<
    string,
    { draft: PurchaseWizardDraft; intake?: PurchaseIntake; durable: boolean }
  >();
  if (local) {
    candidates.set(local.draftId, {
      draft: local,
      intake: systemDrafts.find(({ id, status }) => id === local.draftId && status === 'DRAFT'),
      durable: false,
    });
  }
  for (const systemDraft of systemDrafts) {
    if (systemDraft.status !== 'DRAFT') continue;
    const parsed = parsePurchaseWizardDraft(JSON.stringify(systemDraft.draftData));
    if (!parsed.draft) continue;
    const existing = candidates.get(parsed.draft.draftId);
    const parsedTime = Date.parse(parsed.draft.updatedAt);
    const existingTime = existing ? Date.parse(existing.draft.updatedAt) : Number.NEGATIVE_INFINITY;
    // The draft's own timestamp represents content freshness. Prefer the
    // durable server copy on a tie, while a genuinely newer unsynced local
    // copy keeps the current intake/version and is allowed to autosave.
    if (
      !existing ||
      parsedTime > existingTime ||
      (parsedTime === existingTime && !existing.durable)
    ) {
      candidates.set(parsed.draft.draftId, {
        draft: parsed.draft,
        intake: systemDraft,
        durable: true,
      });
    } else if (!existing.intake) {
      candidates.set(parsed.draft.draftId, { ...existing, intake: systemDraft });
    }
  }
  const selected = [...candidates.values()].sort(
    (left, right) => Date.parse(right.draft.updatedAt) - Date.parse(left.draft.updatedAt),
  )[0];
  if (!selected) return {};
  return {
    intake: selected.intake,
    draft: selected.intake
      ? decorateDraftWithServerAttachments(selected.draft, selected.intake.attachments)
      : selected.draft,
  };
}

function decorateDraftWithServerAttachments(
  draft: PurchaseWizardDraft,
  attachments: IntakeAttachment[],
): PurchaseWizardDraft {
  const statusByClientId = new Map<string, IntakeAttachment['status']>();
  for (const attachment of attachments) {
    const clientMediaId = attachment.processingMetadata?.clientMediaId;
    if (typeof clientMediaId === 'string') statusByClientId.set(clientMediaId, attachment.status);
  }
  const decorate = (media: WizardMedia) => ({
    ...media,
    serverAttachmentStatus: statusByClientId.get(media.id),
  });
  return {
    ...draft,
    photos: draft.photos.map(decorate),
    documents: draft.documents.map(decorate),
  };
}

function loadLocalDraft(): PurchaseWizardDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    return loadPurchaseWizardDraft(window.localStorage, PURCHASE_WIZARD_STORAGE_KEY).draft;
  } catch {
    return null;
  }
}

function clearLocalDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PURCHASE_WIZARD_STORAGE_KEY);
  } catch {
    // The completed server intake is authoritative even when storage is unavailable.
  }
}

async function lookupCompletedIntake(draftId: string): Promise<PurchaseIntake | null> {
  try {
    const latest = await api.get<PurchaseIntake>(
      `/purchase-intakes/${encodeURIComponent(draftId)}`,
    );
    return completedIntakeForDraft(draftId, latest);
  } catch {
    return null;
  }
}

function hydrateUploadedMedia(
  attachments: IntakeAttachment[],
  target: Map<string, UploadedMediaReference>,
): void {
  for (const attachment of attachments) {
    const clientMediaId = attachment.processingMetadata?.clientMediaId;
    if (typeof clientMediaId !== 'string') continue;
    target.set(clientMediaId, {
      id: attachment.id,
      version: attachment.version,
      status: attachment.status,
      variantKinds: new Set(attachment.variants?.map(({ kind }) => kind) ?? []),
    });
  }
}

function LoadError({
  label,
  message,
  retry,
}: {
  label: string;
  message: string;
  retry: () => void;
}) {
  return (
    <div role="alert" className="py-8 text-center text-danger">
      <p>
        無法載入{label}：{message}
      </p>
      <button
        type="button"
        className="mt-2 rounded-lg px-4 font-medium underline-offset-4 hover:underline"
        onClick={retry}
      >
        重試
      </button>
    </div>
  );
}
