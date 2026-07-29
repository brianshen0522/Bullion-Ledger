import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from 'react';

import { api, isApiError } from '../api.js';
import { formatMoney } from '../units.js';
import {
  DISPOSAL_QUANTITY_MIN,
  MONEY_INPUT_MAX,
  MONEY_INPUT_STEP,
  isValidMoneyInput,
  validateAssetDisposal,
  type AssetDisposalValidationField,
  type DisposalAction,
  type ValidatedAssetDisposal,
} from './asset-disposal-model.js';
import { previewSale } from './movements-model.js';
import { toLocalDateTimeInput } from './purchase-form.js';

export type { DisposalAction } from './asset-disposal-model.js';

const ENDPOINTS: Record<DisposalAction, string> = {
  SALE: 'sell',
  GIFT_OUT: 'gift-out',
  LOST: 'lost',
};

const TITLES: Record<DisposalAction, string> = {
  SALE: '售出',
  GIFT_OUT: '贈與他人',
  LOST: '標記遺失',
};

export interface DisposalTarget {
  id: string;
  name: string;
  quantity: number;
  allocatedCost: string;
  currency: string;
  version?: number;
}

/**
 * Records a sale, gift, or loss against one holding.
 *
 * The sale form previews the cost basis and resulting realized P&L before
 * submitting, so a partial disposal is not a leap of faith. The server
 * recomputes both — this is a preview, never the source of truth.
 */
export function AssetDisposalDialog({
  action,
  target,
  onClose,
}: {
  action: DisposalAction;
  target: DisposalTarget;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const conflictActionRef = useRef<HTMLButtonElement>(null);
  const occurredAtRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const proceedsAmountRef = useRef<HTMLInputElement>(null);
  const feesRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [returnFocusTarget] = useState(getFocusReturnTarget);

  const [occurredAt, setOccurredAt] = useState(() => toLocalDateTimeInput());
  const [quantity, setQuantity] = useState(String(target.quantity));
  const [proceedsAmount, setProceedsAmount] = useState('');
  const [fees, setFees] = useState('0');
  const [counterparty, setCounterparty] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<AssetDisposalValidationField | null>(null);
  const [conflict, setConflict] = useState(false);
  const [isRecoveringConflict, setIsRecoveringConflict] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
    };
  }, [returnFocusTarget]);

  useEffect(() => {
    if (conflict) conflictActionRef.current?.focus();
  }, [conflict]);

  const preview =
    action === 'SALE' &&
    proceedsAmount.trim() !== '' &&
    isValidMoneyInput(proceedsAmount) &&
    isValidMoneyInput(fees.trim() || '0')
      ? previewSale({
          quantity: Number(quantity),
          totalQuantity: target.quantity,
          allocatedCost: target.allocatedCost,
          proceedsAmount: proceedsAmount.trim(),
          fees: fees.trim() || '0',
        })
      : null;

  const submit = useMutation({
    mutationFn: (validated: ValidatedAssetDisposal) =>
      api.post(`/assets/${target.id}/${ENDPOINTS[action]}`, {
        occurredAt: validated.occurredAt,
        quantity: validated.quantity,
        counterparty: counterparty.trim() || undefined,
        notes: notes.trim() || undefined,
        ...(target.version === undefined ? {} : { version: target.version }),
        ...(action === 'SALE'
          ? { proceedsAmount: validated.proceedsAmount, fees: validated.fees }
          : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['movements'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      ]);
      onClose();
    },
    onError: (requestError) => {
      if (isApiError(requestError) && requestError.status === 409) {
        setError(null);
        setInvalidField(null);
        setConflict(true);
        return;
      }
      setError(isApiError(requestError) ? requestError.message : '無法完成這筆異動。');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submit.isPending || conflict || isRecoveringConflict) return;
    setError(null);
    setInvalidField(null);
    const validation = validateAssetDisposal(action, target.quantity, {
      occurredAt,
      quantity,
      proceedsAmount,
      fees,
    });
    if (!validation.ok) {
      setError(validation.error);
      setInvalidField(validation.field);
      const fieldRefs: Record<
        AssetDisposalValidationField,
        RefObjectWithCurrent<HTMLInputElement>
      > = {
        occurredAt: occurredAtRef,
        quantity: quantityRef,
        proceedsAmount: proceedsAmountRef,
        fees: feesRef,
      };
      fieldRefs[validation.field].current?.focus();
      return;
    }
    submit.mutate(validation.value);
  }

  function clearFieldError() {
    if (conflict) return;
    setError(null);
    setInvalidField(null);
  }

  function closeIfIdle() {
    if (!submit.isPending && !isRecoveringConflict) onClose();
  }

  function handleBackdropPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) closeIfIdle();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (!submit.isPending && !isRecoveringConflict) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = dialogRef.current ? getFocusableElements(dialogRef.current) : [];
    if (focusable.length === 0) {
      event.preventDefault();
      titleRef.current?.focus();
      return;
    }

    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (activeIndex === -1) {
      event.preventDefault();
      (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
    } else if (event.shiftKey && activeIndex === 0) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  }

  async function handleConflictRecovery() {
    setIsRecoveringConflict(true);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['assets'] }),
      queryClient.invalidateQueries({ queryKey: ['movements'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
    ]);
    onClose();
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleDialogKeyDown}
      onPointerDown={handleBackdropPointerDown}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center"
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        className="surface max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto overscroll-contain rounded-2xl p-5"
      >
        <div>
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-lg font-semibold">
            {TITLES[action]}
          </h2>
          <p id={descriptionId} className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {target.name} · 目前持有 {target.quantity} 件
          </p>
        </div>

        <fieldset
          disabled={submit.isPending || conflict || isRecoveringConflict}
          className="space-y-4"
        >
          <DialogInput
            inputRef={occurredAtRef}
            label="日期"
            type="datetime-local"
            value={occurredAt}
            onChange={(value) => {
              setOccurredAt(value);
              clearFieldError();
            }}
            required
            invalid={invalidField === 'occurredAt'}
            errorId={errorId}
          />
          <DialogInput
            inputRef={quantityRef}
            label={`數量（最多 ${target.quantity}）`}
            type="number"
            inputMode="numeric"
            min={String(DISPOSAL_QUANTITY_MIN)}
            max={String(target.quantity)}
            step="1"
            value={quantity}
            onChange={(value) => {
              setQuantity(value);
              clearFieldError();
            }}
            required
            invalid={invalidField === 'quantity'}
            errorId={errorId}
          />

          {action === 'SALE' && (
            <>
              <DialogInput
                inputRef={proceedsAmountRef}
                label="售出金額"
                type="number"
                inputMode="decimal"
                min="0"
                max={MONEY_INPUT_MAX}
                step={MONEY_INPUT_STEP}
                value={proceedsAmount}
                onChange={(value) => {
                  setProceedsAmount(value);
                  clearFieldError();
                }}
                required
                invalid={invalidField === 'proceedsAmount'}
                errorId={errorId}
              />
              <DialogInput
                inputRef={feesRef}
                label="手續費／鑑定費"
                type="number"
                inputMode="decimal"
                min="0"
                max={MONEY_INPUT_MAX}
                step={MONEY_INPUT_STEP}
                value={fees}
                onChange={(value) => {
                  setFees(value);
                  clearFieldError();
                }}
                invalid={invalidField === 'fees'}
                errorId={errorId}
              />
            </>
          )}

          <DialogInput
            label={action === 'GIFT_OUT' ? '受贈人（選填）' : '對象（選填）'}
            value={counterparty}
            maxLength={128}
            onChange={(value) => {
              setCounterparty(value);
              clearFieldError();
            }}
          />
          <DialogInput
            label="備註（選填）"
            value={notes}
            maxLength={2000}
            onChange={(value) => {
              setNotes(value);
              clearFieldError();
            }}
          />
        </fieldset>

        {preview && (
          <dl className="space-y-1 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">
            <Row label="帶走的成本基礎" value={formatMoney(preview.costBasis, target.currency)} />
            <Row label="淨收入" value={formatMoney(preview.netProceeds, target.currency)} />
            <Row
              label="已實現損益"
              value={formatMoney(preview.realizedPnl, target.currency)}
              tone={preview.realizedPnl.startsWith('-') ? 'loss' : 'gain'}
            />
            <Row label="售出後剩餘" value={`${preview.remainingQuantity} 件`} />
          </dl>
        )}

        {action === 'GIFT_OUT' && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            贈與不計入已實現損益，只會記錄當下市值。
          </p>
        )}

        {error && (
          <p id={errorId} role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}

        {conflict && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950"
          >
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">
              這筆異動未套用，庫存已在其他操作中更新。
            </p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              請重新載入最新庫存，再確認目前持有數量後重試。
            </p>
            <button
              ref={conflictActionRef}
              type="button"
              onClick={() => void handleConflictRecovery()}
              disabled={isRecoveringConflict}
              className="mt-3 min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
            >
              {isRecoveringConflict ? '重新載入中…' : '重新載入並關閉'}
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={submit.isPending || conflict || isRecoveringConflict}
            className="min-h-[44px] rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm disabled:opacity-50"
          >
            {submit.isPending ? '處理中…' : `確認${TITLES[action]}`}
          </button>
          <button
            type="button"
            onClick={closeIfIdle}
            disabled={submit.isPending || isRecoveringConflict}
            className="interactive-muted min-h-[44px] rounded-lg px-4 py-2 disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

type RefObjectWithCurrent<T> = { current: T | null };

function getFocusReturnTarget(): HTMLElement | null {
  if (typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)) {
    return null;
  }

  const activeElement = document.activeElement;
  const menuRoot = activeElement.closest('[role="menu"]')?.parentElement;
  return (
    menuRoot?.querySelector<HTMLElement>('button[aria-haspopup="menu"]') ??
    (activeElement === document.body ? null : activeElement)
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function DialogInput({
  inputRef,
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  min,
  max,
  step,
  maxLength,
  required,
  invalid,
  errorId,
}: {
  inputRef?: Ref<HTMLInputElement>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
  min?: string;
  max?: string;
  step?: string;
  maxLength?: number;
  required?: boolean;
  invalid?: boolean;
  errorId?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        ref={inputRef}
        id={id}
        className="w-full rounded-lg border px-3 py-2"
        type={type}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
      />
    </label>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  const toneClass =
    tone === 'gain'
      ? 'text-teal-700 dark:text-teal-400'
      : tone === 'loss'
        ? 'text-red-700 dark:text-red-400'
        : '';
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
      <dd className={`tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}
