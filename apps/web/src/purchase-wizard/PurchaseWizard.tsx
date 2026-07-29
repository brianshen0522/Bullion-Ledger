import { useEffect, useMemo, useRef, useState } from 'react';

import { isApiError } from '../api.js';
import { resolveIdempotencyAttempt, type IdempotencyAttempt } from '../idempotency.js';
import { WizardErrorSummary } from './fields.js';
import { createBrowserWizardHistory, type WizardHistoryAdapter } from './history.js';
import { DocumentsStep, ProductPhotosStep } from './media.js';
import { revokeWizardMediaPreview } from './media-utils.js';
import {
  buildWizardPurchasePayload,
  createPurchaseWizardDraft,
  normalizePrimaryWizardPhotos,
  setWizardStep,
  touchWizardDraft,
  wizardStepIndex,
} from './model.js';
import {
  loadPurchaseWizardDraft,
  PURCHASE_WIZARD_STORAGE_KEY,
  useWizardAutosave,
  type DraftRestoreStatus,
  type KeyValueStorage,
} from './storage.js';
import { CostsStep, ItemsStep, ReviewStep, TransactionStep } from './steps.js';
import {
  PURCHASE_WIZARD_STEPS,
  type OrganizationSearchProvider,
  type PurchaseWizardDraft,
  type PurchaseWizardStep,
  type WizardMetal,
  type WizardOrganization,
  type WizardProduct,
  type WizardPurchasePayload,
  type WizardValidationIssue,
} from './types.js';
import { firstInvalidStep, validateEntireWizard, validateWizardStep } from './validation.js';

export interface PurchaseWizardProps {
  metals: readonly WizardMetal[];
  products?: readonly WizardProduct[];
  organizations?: readonly WizardOrganization[];
  searchOrganizations?: OrganizationSearchProvider;
  initialDraft?: PurchaseWizardDraft;
  storage?: KeyValueStorage | null;
  storageKey?: string;
  history?: WizardHistoryAdapter | null;
  onSystemSave?: (draft: PurchaseWizardDraft) => Promise<void>;
  onCatalogConflict?: () => Promise<void> | void;
  onFinalize: (
    payload: WizardPurchasePayload,
    idempotencyKey: string,
    draft: PurchaseWizardDraft,
  ) => Promise<unknown>;
  onCompleted?: (result: unknown) => void;
  onCancel?: () => void;
}

export function PurchaseWizard({
  metals,
  products = [],
  organizations = [],
  searchOrganizations,
  initialDraft,
  storage: providedStorage,
  storageKey = PURCHASE_WIZARD_STORAGE_KEY,
  history: providedHistory,
  onSystemSave,
  onCatalogConflict,
  onFinalize,
  onCompleted,
  onCancel,
}: PurchaseWizardProps) {
  const storage = useMemo(
    () => (providedStorage === undefined ? safeBrowserStorage() : providedStorage),
    [providedStorage],
  );
  const history = useMemo(
    () =>
      providedHistory === undefined
        ? typeof window === 'undefined'
          ? null
          : createBrowserWizardHistory(window)
        : providedHistory,
    [providedHistory],
  );
  const initial = useMemo(
    () => resolveInitialDraft(initialDraft, storage, storageKey, history, metals[0]?.code),
    // Initial state is intentionally resolved once; changing catalog arrays must not reset a draft.
    [],
  );
  const [draft, setDraft] = useState(initial.draft);
  const [restoreStatus, setRestoreStatus] = useState<DraftRestoreStatus>(initial.restoreStatus);
  const [issues, setIssues] = useState<WizardValidationIssue[]>([]);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const draftRef = useRef(draft);
  const finalizingRef = useRef(false);
  const idempotencyAttempt = useRef<IdempotencyAttempt | null>(null);
  const autosave = useWizardAutosave(draft, {
    storage,
    storageKey,
    onSystemSave,
  });

  useEffect(() => {
    draftRef.current = draft;
    if (issues.length > 0) setIssues(validateWizardStep(draft, draft.currentStep));
  }, [draft, issues.length]);

  useEffect(() => {
    if (!history) return;
    history.replace(draftRef.current.currentStep);
    return history.subscribe((requested) => {
      if (!requested || finalizingRef.current) return;
      setDraft((current) => {
        if (wizardStepIndex(requested) > wizardStepIndex(current.furthestStep)) return current;
        return setWizardStep(current, requested);
      });
      setFinalizeError(null);
    });
  }, [history]);

  useEffect(
    () => () => {
      for (const media of [...draftRef.current.photos, ...draftRef.current.documents]) {
        revokeWizardMediaPreview(media);
      }
    },
    [],
  );

  function updateDraft(updater: (current: PurchaseWizardDraft) => PurchaseWizardDraft) {
    if (finalizingRef.current) return;
    setDraft((current) => touchWizardDraft(updater(current)));
    setFinalizeError(null);
  }

  function navigate(step: PurchaseWizardStep, push = true) {
    if (finalizingRef.current) return;
    setDraft((current) => setWizardStep(current, step));
    if (push) history?.push(step);
    setIssues([]);
    setFinalizeError(null);
    scrollWizardTop();
  }

  function goNext() {
    if (finalizingRef.current) return;
    const currentIssues = validateWizardStep(draft, draft.currentStep);
    if (currentIssues.length > 0) {
      setIssues(currentIssues);
      focusWizardIssue(currentIssues[0]);
      return;
    }
    const next = PURCHASE_WIZARD_STEPS[wizardStepIndex(draft.currentStep) + 1]?.id;
    if (!next) return;
    navigate(next);
    void autosave.flush();
  }

  function goBack() {
    if (finalizingRef.current) return;
    const previous = PURCHASE_WIZARD_STEPS[wizardStepIndex(draft.currentStep) - 1]?.id;
    if (previous) navigate(previous);
  }

  async function finalize() {
    if (finalizingRef.current) return;

    const staleItems = draft.items.filter((item) => {
      if (!item.productDefinitionId) return false;
      const product = products.find(({ id }) => id === item.productDefinitionId);
      return !product || product.version !== item.productDefinitionVersion;
    });
    if (staleItems.length > 0) {
      navigate('items');
      return;
    }

    const allIssues = validateEntireWizard(draft);
    if (allIssues.length > 0) {
      const invalidStep = firstInvalidStep(draft) ?? 'transaction';
      setDraft((current) => setWizardStep(current, invalidStep));
      history?.push(invalidStep);
      setIssues(validateWizardStep(draft, invalidStep));
      focusWizardIssue(allIssues[0]);
      return;
    }

    finalizingRef.current = true;
    setFinalizing(true);
    setFinalizeError(null);
    try {
      await autosave.flush();
      const payload = buildWizardPurchasePayload(draft);
      const attempt = resolveIdempotencyAttempt(
        idempotencyAttempt.current,
        JSON.stringify(payload),
      );
      idempotencyAttempt.current = attempt;
      const result = await onFinalize(payload, attempt.key, draft);
      idempotencyAttempt.current = null;
      autosave.clear();
      onCompleted?.(result);
    } catch (error) {
      finalizingRef.current = false;
      setFinalizing(false);
      if (isProductCatalogConflict(error)) {
        try {
          await onCatalogConflict?.();
        } catch {
          // The actionable catalog-conflict state is still more useful than
          // replacing it with a secondary refresh error. The user can retry.
        }
        navigate('items');
        setFinalizeError('商品規格已更新，請套用最新版或改為自訂後再送出。');
        return;
      }
      setFinalizeError(error instanceof Error ? error.message : '入庫失敗，請稍後重試。');
    }
  }

  const currentIndex = wizardStepIndex(draft.currentStep);
  const furthestIndex = wizardStepIndex(draft.furthestStep);

  return (
    <form
      className="mx-auto min-w-0 max-w-5xl"
      noValidate
      aria-busy={finalizing}
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.currentStep === 'review' && !finalizing) void finalize();
      }}
    >
      <fieldset disabled={finalizing} className="m-0 min-w-0 space-y-5 border-0 p-0">
        <header className="space-y-3" data-wizard-top>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-accent dark:text-teal-400">行動入庫工作台</p>
              <h1 className="text-2xl font-semibold tracking-tight">新增購買入庫</h1>
            </div>
            <SaveStatus
              localState={autosave.localState}
              systemState={autosave.systemState}
              localSavedAt={autosave.lastLocalSaveAt}
              systemSavedAt={autosave.lastSystemSaveAt}
            />
          </div>
          {restoreStatus === 'restored' && (
            <ResumeNotice onDismiss={() => setRestoreStatus('missing')}>
              已接續先前儲存的入庫草稿。
            </ResumeNotice>
          )}
          {(restoreStatus === 'corrupt' || restoreStatus === 'unsupported-version') && (
            <ResumeNotice onDismiss={() => setRestoreStatus('missing')} tone="warning">
              原草稿無法安全讀取，已開啟新的空白草稿。
            </ResumeNotice>
          )}
          {autosave.error && (
            <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
              {autosave.error} 表單仍保留在目前頁面。
            </p>
          )}
          <p
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={PURCHASE_WIZARD_STEPS.length}
            aria-valuenow={currentIndex + 1}
            className="text-sm text-slate-600 dark:text-slate-300"
          >
            第 {currentIndex + 1}／{PURCHASE_WIZARD_STEPS.length} 步：
            {PURCHASE_WIZARD_STEPS[currentIndex]?.label}
          </p>
          <nav className="max-w-full overflow-x-auto pb-1" aria-label="入庫步驟">
            <ol className="grid min-w-[34rem] grid-cols-6 gap-1">
              {PURCHASE_WIZARD_STEPS.map((step, index) => {
                const reached = index <= furthestIndex;
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      aria-current={draft.currentStep === step.id ? 'step' : undefined}
                      aria-disabled={!reached}
                      disabled={!reached}
                      className={`min-h-11 w-full rounded-lg px-2 py-2 text-xs font-medium motion-safe:transition-colors ${
                        draft.currentStep === step.id
                          ? 'bg-accent text-white shadow-sm'
                          : reached
                            ? 'interactive-muted bg-slate-100 dark:bg-slate-800'
                            : 'bg-slate-100 text-slate-400 opacity-60 dark:bg-slate-900 dark:text-slate-600'
                      }`}
                      onClick={() => reached && navigate(step.id)}
                    >
                      <span className="block">{index + 1}</span>
                      <span>{step.shortLabel}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </header>

        <main className="min-w-0 motion-safe:transition-opacity">
          {draft.currentStep === 'transaction' ? (
            <TransactionStep
              value={draft.transaction}
              issues={issues}
              onChange={(transaction) => updateDraft((current) => ({ ...current, transaction }))}
            />
          ) : draft.currentStep === 'items' ? (
            <ItemsStep
              items={draft.items}
              metals={metals}
              products={products}
              organizations={organizations}
              searchOrganizations={searchOrganizations}
              issues={issues}
              onChange={(items) =>
                updateDraft((current) => {
                  const validItemIds = new Set(items.map(({ id }) => id));
                  return {
                    ...current,
                    items,
                    photos: normalizePrimaryWizardPhotos(
                      current.photos.map((photo) =>
                        photo.targetItemId && !validItemIds.has(photo.targetItemId)
                          ? { ...photo, targetItemId: undefined }
                          : photo,
                      ),
                    ),
                  };
                })
              }
            />
          ) : draft.currentStep === 'costs' ? (
            <CostsStep
              costs={draft.costs}
              items={draft.items}
              issues={issues}
              onCostsChange={(costs) => updateDraft((current) => ({ ...current, costs }))}
              onItemsChange={(items) => updateDraft((current) => ({ ...current, items }))}
            />
          ) : draft.currentStep === 'photos' ? (
            <ProductPhotosStep
              items={draft.items}
              photos={draft.photos}
              onChange={(photos) => updateDraft((current) => ({ ...current, photos }))}
            />
          ) : draft.currentStep === 'documents' ? (
            <DocumentsStep
              documents={draft.documents}
              onChange={(documents) => updateDraft((current) => ({ ...current, documents }))}
            />
          ) : (
            <>
              <WizardErrorSummary issues={issues} />
              <ReviewStep draft={draft} />
            </>
          )}
        </main>

        {finalizeError && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-danger dark:bg-red-950">
            {finalizeError}
          </p>
        )}

        <footer className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:mx-0 sm:rounded-xl sm:border">
          <button
            type="button"
            disabled={currentIndex === 0 || finalizing}
            className="interactive-muted rounded-lg px-4 font-medium disabled:opacity-30"
            onClick={goBack}
          >
            上一步
          </button>
          {draft.currentStep === 'review' ? (
            <button
              type="submit"
              disabled={finalizing}
              className="ml-auto rounded-lg bg-accent px-5 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
            >
              {finalizing ? '正在入庫…' : '確認並完成入庫'}
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
          {onCancel && (
            <button
              type="button"
              disabled={finalizing}
              className="interactive-muted rounded-lg px-3 text-sm font-medium disabled:opacity-30"
              onClick={onCancel}
            >
              先離開
            </button>
          )}
        </footer>
      </fieldset>
    </form>
  );
}

export function isProductCatalogConflict(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === 'PRODUCT_VERSION_CONFLICT';
}

function resolveInitialDraft(
  initialDraft: PurchaseWizardDraft | undefined,
  storage: KeyValueStorage | null,
  storageKey: string,
  history: WizardHistoryAdapter | null,
  metalCode?: string,
): { draft: PurchaseWizardDraft; restoreStatus: DraftRestoreStatus } {
  const restored = initialDraft
    ? { draft: initialDraft, status: 'restored' as const }
    : storage
      ? loadPurchaseWizardDraft(storage, storageKey)
      : { draft: null, status: 'missing' as const };
  let draft = restored.draft ?? createPurchaseWizardDraft({ metalCode });
  draft = { ...draft, photos: normalizePrimaryWizardPhotos(draft.photos) };
  const requestedStep = history?.read();
  if (requestedStep && wizardStepIndex(requestedStep) <= wizardStepIndex(draft.furthestStep)) {
    draft = { ...draft, currentStep: requestedStep };
  }
  return { draft, restoreStatus: restored.status };
}

function safeBrowserStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function SaveStatus({
  localState,
  systemState,
  localSavedAt,
  systemSavedAt,
}: {
  localState: string;
  systemState: string;
  localSavedAt: string | null;
  systemSavedAt: string | null;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1 text-xs" aria-live="polite">
      <SavePill
        label="此裝置"
        state={localState}
        savedAt={localSavedAt}
        unavailableLabel="不可用"
      />
      <SavePill
        label="系統"
        state={systemState}
        savedAt={systemSavedAt}
        unavailableLabel="尚未連接"
      />
    </div>
  );
}

function SavePill({
  label,
  state,
  savedAt,
  unavailableLabel,
}: {
  label: string;
  state: string;
  savedAt: string | null;
  unavailableLabel: string;
}) {
  const stateLabel =
    state === 'saved'
      ? savedAt
        ? `已儲存 ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : '已儲存'
      : state === 'saving'
        ? '儲存中'
        : state === 'dirty'
          ? '尚未儲存'
          : state === 'error'
            ? '儲存失敗'
            : unavailableLabel;
  return (
    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {label}：{stateLabel}
    </span>
  );
}

function ResumeNotice({
  children,
  onDismiss,
  tone = 'info',
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  tone?: 'info' | 'warning';
}) {
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
        tone === 'warning'
          ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
          : 'bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100'
      }`}
    >
      <span>{children}</span>
      <button
        type="button"
        className="min-h-11 shrink-0 rounded px-2 underline"
        onClick={onDismiss}
      >
        知道了
      </button>
    </div>
  );
}

function focusWizardIssue(issue: WizardValidationIssue | undefined) {
  if (typeof document === 'undefined') return;
  globalThis.setTimeout(() => {
    const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-wizard-path]'));
    const field = fields.find((element) => element.dataset.wizardPath === issue?.path);
    (field ?? document.querySelector<HTMLElement>('[data-wizard-error-summary]'))?.focus();
  }, 0);
}

function scrollWizardTop() {
  if (typeof document === 'undefined') return;
  globalThis.setTimeout(() => {
    document.querySelector('[data-wizard-top]')?.scrollIntoView({
      behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'start',
    });
  }, 0);
}
