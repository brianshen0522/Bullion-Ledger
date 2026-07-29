import { WEIGHT_UNITS, WEIGHT_UNIT_LABELS } from '@bullion-ledger/shared';
import Decimal from 'decimal.js';
import { useState } from 'react';

import { computeLinePreview } from '../screens/purchase-preview.js';
import { convertUnitWeightInput } from '../screens/purchase-form.js';
import { productFormOptions } from '../product-forms.js';
import { SearchableSelect } from '../SearchableSelect.js';
import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  PACKAGING_OPTIONS,
  withCurrentReferenceOption,
  type ReferenceOption,
} from '../reference-options.js';
import {
  applyProductToItem,
  createEmptyWizardItem,
  createStableId,
  deriveSubtotal,
} from './model.js';
import {
  BrandOrganizationSelector,
  NON_BRAND_ORGANIZATION_ROLES,
  ORGANIZATION_ROLE_LABELS,
  OrganizationAssignmentsEditor,
} from './organization-search.js';
import { paymentMethodLabel, paymentMethodOptions } from './payment-methods.js';
import {
  issueForPath,
  WizardErrorSummary,
  WizardField,
  WizardSelect,
  WizardTextarea,
} from './fields.js';
import { DealerCombobox } from './dealer-combobox.js';
import type {
  OrganizationSearchProvider,
  PurchaseWizardDraft,
  WizardCosts,
  WizardItem,
  WizardMetal,
  WizardOrganization,
  WizardProduct,
  WizardTransaction,
  WizardValidationIssue,
} from './types.js';

const OPTIONAL_COUNTRY_OPTIONS: readonly ReferenceOption[] = [
  { value: '', label: '未指定' },
  ...COUNTRY_OPTIONS,
];

const ALLOCATION_METHOD_OPTIONS = [
  { value: 'SUBTOTAL_PROPORTIONAL', label: '依商品金額比例' },
  { value: 'WEIGHT_PROPORTIONAL', label: '依純金屬重量比例' },
  { value: 'EQUAL', label: '平均分攤' },
  { value: 'MANUAL', label: '手動指定' },
] as const;

interface TransactionStepProps {
  value: WizardTransaction;
  issues: readonly WizardValidationIssue[];
  onChange: (value: WizardTransaction) => void;
}

export function TransactionStep({ value, issues, onChange }: TransactionStepProps) {
  const patch = (next: Partial<WizardTransaction>) => onChange({ ...value, ...next });
  const [dealerBranches, setDealerBranches] = useState<string[]>([]);
  const branchHint = dealerBranches.length > 0
    ? `已有分店：${dealerBranches.join('、')}`
    : undefined;
  return (
    <section aria-labelledby="wizard-transaction-heading" className="space-y-4">
      <div>
        <h2 id="wizard-transaction-heading" className="text-xl font-semibold">
          交易資訊
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          先記錄購買時間與交易來源，其餘欄位都可稍後補齊。
        </p>
      </div>
      <WizardErrorSummary issues={issues} />
      <div className="surface grid min-w-0 gap-4 rounded-xl p-4 sm:grid-cols-2">
        <WizardField
          label="購買日期與時間"
          path="transaction.purchasedAt"
          type="datetime-local"
          value={value.purchasedAt}
          onChange={(purchasedAt) => patch({ purchasedAt })}
          issues={issues}
          required
        />
        <SearchableSelect
          label="幣別"
          dataPath="transaction.currency"
          value={value.currency}
          onChange={(currency) => patch({ currency })}
          options={CURRENCY_OPTIONS}
          error={issueForPath(issues, 'transaction.currency')?.message}
          required
          placeholder="請選擇幣別"
          searchPlaceholder="搜尋代碼、中文、英文或別名"
        />
        <DealerCombobox
          value={value.dealerName}
          onChange={(dealerName) => patch({ dealerName })}
          onBranches={(branches) => {
            setDealerBranches(branches);
            if (branches.length === 1 && !value.branch) {
              patch({ branch: branches[0]! });
            }
          }}
          error={issueForPath(issues, 'transaction.dealerName')?.message}
        />
        <WizardField
          label="分店或通路"
          path="transaction.branch"
          value={value.branch}
          onChange={(branch) => patch({ branch })}
          issues={issues}
          maxLength={128}
          hint={branchHint}
        />
        <WizardField
          label="訂單編號"
          path="transaction.orderNumber"
          value={value.orderNumber}
          onChange={(orderNumber) => patch({ orderNumber })}
          issues={issues}
          maxLength={128}
        />
        <WizardField
          label="發票號碼"
          path="transaction.invoiceNumber"
          value={value.invoiceNumber}
          onChange={(invoiceNumber) => patch({ invoiceNumber })}
          issues={issues}
          maxLength={128}
        />
        <WizardSelect
          label="付款方式"
          path="transaction.paymentMethod"
          value={value.paymentMethod}
          onChange={(paymentMethod) => patch({ paymentMethod })}
          issues={issues}
          options={[
            { value: '', label: '未選擇（選填）' },
            ...paymentMethodOptions(value.paymentMethod).map(([method, label]) => ({
              value: method,
              label,
            })),
          ]}
        />
      </div>
      <WizardTextarea
        label="備註"
        path="transaction.notes"
        value={value.notes}
        onChange={(notes) => patch({ notes })}
        maxLength={4000}
      />
    </section>
  );
}

interface ItemsStepProps {
  items: readonly WizardItem[];
  metals: readonly WizardMetal[];
  products: readonly WizardProduct[];
  organizations?: readonly WizardOrganization[];
  searchOrganizations?: OrganizationSearchProvider;
  issues: readonly WizardValidationIssue[];
  onChange: (items: WizardItem[]) => void;
}

export function ItemsStep({
  items,
  metals,
  products,
  organizations,
  searchOrganizations,
  issues,
  onChange,
}: ItemsStepProps) {
  function patch(id: string, next: Partial<WizardItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }

  function customize(id: string, next: Partial<WizardItem>) {
    patch(id, { ...next, productDefinitionId: '', productDefinitionVersion: undefined });
  }

  function staleProductWarnings(items: readonly WizardItem[]) {
    return items
      .map((item, index) => {
        if (!item.productDefinitionId) return null;
        const product = products.find(({ id }) => id === item.productDefinitionId);
        if (!product) return { index, item, reason: 'missing' as const };
        if (product.version !== item.productDefinitionVersion)
          return { index, item, reason: 'stale' as const, product };
        return null;
      })
      .filter(Boolean) as Array<
      | { index: number; item: WizardItem; reason: 'missing' }
      | { index: number; item: WizardItem; reason: 'stale'; product: WizardProduct }
    >;
  }

  function move(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [entry] = next.splice(index, 1);
    next.splice(to, 0, entry!);
    onChange(next);
  }

  return (
    <section aria-labelledby="wizard-items-heading" className="space-y-4">
      <div>
        <h2 id="wizard-items-heading" className="text-xl font-semibold">
          商品與重量
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          每種規格建立一項。品牌、發行方、精煉廠與實際鑄造者可分開記錄。
        </p>
      </div>
      <WizardErrorSummary issues={issues} />
      {staleProductWarnings(items).length > 0 && (
        <div className="space-y-2">
          {staleProductWarnings(items).map((warning) => (
            <div
              key={warning.item.id}
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
            >
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                商品 {warning.index + 1}「{warning.item.name}」
                {warning.reason === 'missing' ? '的模板已不存在' : '的模板已有新版'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {warning.reason === 'stale' && (
                  <button
                    type="button"
                    className="min-h-11 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-700"
                    onClick={() =>
                      patch(warning.item.id, applyProductToItem(warning.item, warning.product))
                    }
                  >
                    套用最新版
                  </button>
                )}
                <button
                  type="button"
                  className="min-h-11 rounded-lg border border-amber-400 px-4 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-900"
                  onClick={() =>
                    customize(warning.item.id, {
                      name: warning.item.name,
                      form: warning.item.form,
                    })
                  }
                >
                  改為自訂
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-4">
        {items.map((item, index) => {
          const base = `items.${item.id}`;
          const preview = computeLinePreview(item, []);
          return (
            <fieldset key={item.id} className="surface min-w-0 space-y-4 rounded-xl p-4">
              <legend className="px-1 font-semibold">商品 {index + 1}</legend>
              <div className="flex flex-wrap items-center justify-end gap-1">
                <SmallAction
                  label={`上移商品 ${index + 1}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </SmallAction>
                <SmallAction
                  label={`下移商品 ${index + 1}`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </SmallAction>
                <button
                  type="button"
                  className="interactive-muted rounded-lg px-3 text-sm font-medium"
                  onClick={() => {
                    const copy: WizardItem = {
                      ...item,
                      id: createStableId('item'),
                      serial: '',
                      organizations: item.organizations.map((assignment) => ({
                        ...assignment,
                        id: createStableId('party'),
                      })),
                    };
                    const next = [...items];
                    next.splice(index + 1, 0, copy);
                    onChange(next);
                  }}
                >
                  複製
                </button>
                <button
                  type="button"
                  disabled={items.length <= 1}
                  className="rounded-lg px-3 text-sm font-medium text-danger disabled:opacity-30"
                  onClick={() => onChange(items.filter(({ id }) => id !== item.id))}
                >
                  移除
                </button>
              </div>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <WizardSelect
                  label="商品模板"
                  path={`${base}.productDefinitionId`}
                  value={item.productDefinitionId}
                  onChange={(productId) => {
                    if (!productId) {
                      patch(item.id, {
                        productDefinitionId: '',
                        productDefinitionVersion: undefined,
                      });
                      return;
                    }
                    const product = products.find(({ id }) => id === productId);
                    if (product) patch(item.id, applyProductToItem(item, product));
                  }}
                  issues={issues}
                  className="lg:col-span-2"
                  options={[
                    { value: '', label: '自訂商品…' },
                    ...products.map((product) => ({
                      value: product.id,
                      label: `${product.name} (${product.metalCode})`,
                    })),
                  ]}
                />
                <WizardSelect
                  label="金屬"
                  path={`${base}.metalCode`}
                  value={item.metalCode}
                  onChange={(metalCode) =>
                    patch(item.id, {
                      metalCode,
                      productDefinitionId: '',
                      productDefinitionVersion: undefined,
                    })
                  }
                  issues={issues}
                  required
                  options={[
                    { value: '', label: '請選擇…' },
                    ...metals.map((metal) => ({
                      value: metal.code,
                      label: `${metal.code} — ${metal.name}`,
                    })),
                  ]}
                />
                <WizardField
                  label="商品名稱"
                  path={`${base}.name`}
                  value={item.name}
                  onChange={(name) => customize(item.id, { name })}
                  issues={issues}
                  required
                  maxLength={128}
                  className="sm:col-span-2"
                />
                <WizardSelect
                  label="商品形式"
                  path={`${base}.form`}
                  value={item.form}
                  onChange={(form) => customize(item.id, { form })}
                  issues={issues}
                  required
                  options={productFormOptions(item.metalCode).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
                <WizardField
                  label="數量"
                  path={`${base}.quantity`}
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  inputMode="numeric"
                  value={item.quantity}
                  onChange={(quantity) => patch(item.id, { quantity })}
                  issues={issues}
                  required
                />
                <WizardField
                  label="單件重量"
                  path={`${base}.unitWeight`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={item.unitWeight}
                  onChange={(unitWeight) => customize(item.id, { unitWeight })}
                  issues={issues}
                  required
                />
                <WizardSelect
                  label="重量單位"
                  path={`${base}.weightUnit`}
                  value={item.weightUnit}
                  onChange={(unit) => {
                    const nextUnit = unit as WizardItem['weightUnit'];
                    try {
                      customize(item.id, {
                        weightUnit: nextUnit,
                        unitWeight: convertUnitWeightInput(
                          item.unitWeight,
                          item.weightUnit,
                          nextUnit,
                        ),
                      });
                    } catch {
                      customize(item.id, { weightUnit: nextUnit });
                    }
                  }}
                  issues={issues}
                  required
                  options={WEIGHT_UNITS.map((unit) => ({
                    value: unit,
                    label: WEIGHT_UNIT_LABELS[unit],
                  }))}
                />
                <WizardField
                  label="純度（0–1）"
                  path={`${base}.purity`}
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  inputMode="decimal"
                  value={item.purity}
                  onChange={(purity) => customize(item.id, { purity })}
                  issues={issues}
                  required
                  hint="例如 999.9‰ 請輸入 0.9999"
                />
                <WizardField
                  label="序號"
                  path={`${base}.serial`}
                  value={item.serial}
                  onChange={(serial) => patch(item.id, { serial })}
                  issues={issues}
                  maxLength={128}
                />
                <WizardField
                  label="年份／版本"
                  path={`${base}.yearOrVersion`}
                  value={item.yearOrVersion}
                  onChange={(yearOrVersion) => customize(item.id, { yearOrVersion })}
                  issues={issues}
                  maxLength={64}
                />
                <SearchableSelect
                  label="生產國家"
                  dataPath={`${base}.country`}
                  value={item.country}
                  onChange={(country) => customize(item.id, { country })}
                  options={OPTIONAL_COUNTRY_OPTIONS}
                  error={issueForPath(issues, `${base}.country`)?.message}
                  placeholder="未指定"
                  searchPlaceholder="搜尋代碼、中文、英文或別名"
                />
                <WizardSelect
                  label="包裝狀態"
                  path={`${base}.packagingState`}
                  value={item.packagingState}
                  onChange={(packagingState) => patch(item.id, { packagingState })}
                  issues={issues}
                  options={[
                    { value: '', label: '未指定' },
                    ...withCurrentReferenceOption(PACKAGING_OPTIONS, item.packagingState).map(
                      (option) => ({
                        value: option.value,
                        label: option.label,
                        description: option.description,
                      }),
                    ),
                  ]}
                />
                <WizardField
                  label="初始存放位置"
                  path={`${base}.initialStorageLocation`}
                  value={item.initialStorageLocation}
                  onChange={(initialStorageLocation) => patch(item.id, { initialStorageLocation })}
                  issues={issues}
                  maxLength={128}
                />
                {/* `self-end` keeps the box its natural height and aligned with
                    the inputs beside it, instead of stretching to match the
                    tallest cell in the row. */}
                <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">
                  <input
                    type="checkbox"
                    className="h-5 min-h-0 w-5"
                    checked={item.hasCertificate}
                    onChange={(event) => patch(item.id, { hasCertificate: event.target.checked })}
                  />
                  <span className="font-medium">附證書</span>
                </label>
                {item.productDefinitionId ? (
                  <CatalogOrganizationSummary assignments={item.organizations} />
                ) : (
                  <>
                    <BrandOrganizationSelector
                      assignments={item.organizations}
                      localOptions={organizations}
                      searchProvider={searchOrganizations}
                      onChange={(nextOrganizations) =>
                        patch(item.id, { organizations: nextOrganizations })
                      }
                    />
                    <OrganizationAssignmentsEditor
                      assignments={item.organizations}
                      localOptions={organizations}
                      searchProvider={searchOrganizations}
                      roles={NON_BRAND_ORGANIZATION_ROLES}
                      roleLabel="其他來源角色"
                      emptyMessage="尚未指定發行方、精煉廠或實際製造來源；不知道時可稍後補齊。"
                      onChange={(nextOrganizations) =>
                        patch(item.id, { organizations: nextOrganizations })
                      }
                    />
                  </>
                )}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
                {preview}
              </p>
            </fieldset>
          );
        })}
      </div>
      <button
        type="button"
        disabled={items.length >= 100}
        className="surface w-full rounded-xl px-4 py-3 font-medium text-accent hover:bg-teal-50 disabled:opacity-40 dark:text-teal-400 dark:hover:bg-teal-950 sm:w-auto"
        onClick={() => onChange([...items, createEmptyWizardItem(items[0]?.metalCode ?? '')])}
      >
        ＋新增商品
      </button>
    </section>
  );
}

function CatalogOrganizationSummary({
  assignments,
}: {
  assignments: readonly WizardItem['organizations'][number][];
}) {
  // Spans the whole row via `col-span-full`, never a counted span: a span wider
  // than the container's explicit columns makes CSS Grid invent implicit,
  // content-sized columns, which collapses every sibling field to the width of
  // its own label.
  return (
    <div className="col-span-full space-y-2">
      <p className="text-sm font-medium">商品模板的組織來源</p>
      {assignments.length ? (
        <ul className="flex flex-wrap gap-2">
          {assignments.map((assignment) => (
            <li
              key={assignment.id}
              className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
            >
              {ORGANIZATION_ROLE_LABELS[assignment.role]}：{assignment.displayName}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">此模板尚未指定組織來源。</p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        模板來源會由系統保存為權威快照；如需自行指定，請改選「自訂商品」。
      </p>
    </div>
  );
}

interface CostsStepProps {
  costs: WizardCosts;
  items: readonly WizardItem[];
  issues: readonly WizardValidationIssue[];
  onCostsChange: (costs: WizardCosts) => void;
  onItemsChange: (items: WizardItem[]) => void;
}

export function CostsStep({ costs, items, issues, onCostsChange, onItemsChange }: CostsStepProps) {
  const patchCosts = (next: Partial<WizardCosts>) => onCostsChange({ ...costs, ...next });
  const patchItem = (id: string, next: Partial<WizardItem>) =>
    onItemsChange(items.map((item) => (item.id === id ? { ...item, ...next } : item)));
  const itemized = costs.mode === 'ITEMIZED';
  const derivedSubtotal = deriveSubtotal(items);
  // Preview against the resolved costs so SIMPLE mode never shows a stale
  // premium left behind by a visit to the itemized view.
  const effectiveCosts = resolveCostsFor(costs, derivedSubtotal);
  const total = purchaseTotalPreview(effectiveCosts);
  const itemizedExtras = sumMoney([
    effectiveCosts.premium,
    effectiveCosts.labor,
    effectiveCosts.tax,
    effectiveCosts.otherFees,
  ]);
  const shippingLessDiscount = sumMoney([effectiveCosts.shipping, `-${effectiveCosts.discount}`]);

  return (
    <section aria-labelledby="wizard-costs-heading" className="space-y-4">
      <div>
        <h2 id="wizard-costs-heading" className="text-xl font-semibold">
          價格與費用
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {itemized
            ? '依發票逐項填寫；共同費用會依選擇的方法分攤。'
            : '填你實際付的商品價格（已含溢價與工錢）。購入溢價會用買入當下的現貨價自動算出，不需要自己拆帳。'}
        </p>
      </div>
      <WizardErrorSummary issues={issues} />

      <div className="surface space-y-4 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium">交易層級費用</h3>
          <button
            type="button"
            onClick={() => patchCosts({ mode: itemized ? 'SIMPLE' : 'ITEMIZED' })}
            className="interactive-muted rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
          >
            {itemized ? '改用簡易輸入' : '我有完整發票，逐項填寫'}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MoneyField
            label="運費"
            path="costs.shipping"
            value={costs.shipping}
            onChange={(shipping) => patchCosts({ shipping })}
            issues={issues}
          />
          <MoneyField
            label="折扣"
            path="costs.discount"
            value={costs.discount}
            onChange={(discount) => patchCosts({ discount })}
            issues={issues}
          />
          {itemized && (
            <>
              <MoneyField
                label="商家標示溢價"
                path="costs.premium"
                value={costs.premium}
                onChange={(premium) => patchCosts({ premium })}
                issues={issues}
              />
              <MoneyField
                label="工錢"
                path="costs.labor"
                value={costs.labor}
                onChange={(labor) => patchCosts({ labor })}
                issues={issues}
              />
              <MoneyField
                label="稅費"
                path="costs.tax"
                value={costs.tax}
                onChange={(tax) => patchCosts({ tax })}
                issues={issues}
              />
              <MoneyField
                label="其他費用"
                path="costs.otherFees"
                value={costs.otherFees}
                onChange={(otherFees) => patchCosts({ otherFees })}
                issues={issues}
              />
            </>
          )}
          {items.length > 1 && (
            <WizardSelect
              label="成本分攤方法"
              path="costs.allocationMethod"
              value={costs.allocationMethod}
              onChange={(allocationMethod) =>
                patchCosts({
                  allocationMethod: allocationMethod as WizardCosts['allocationMethod'],
                })
              }
              issues={issues}
              required
              options={ALLOCATION_METHOD_OPTIONS}
            />
          )}
        </div>
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="surface grid min-w-0 gap-4 rounded-xl p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <h3 className="font-medium">
                {index + 1}. {item.name || '未命名商品'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                數量 {item.quantity} · {item.unitWeight} {WEIGHT_UNIT_LABELS[item.weightUnit]}
              </p>
            </div>
            <MoneyField
              label={itemized ? '商品小計' : '商品價格（含溢價與工錢）'}
              path={`items.${item.id}.lineSubtotal`}
              value={item.lineSubtotal}
              onChange={(lineSubtotal) => patchItem(item.id, { lineSubtotal })}
              issues={issues}
            />
            {items.length > 1 && costs.allocationMethod === 'MANUAL' && (
              <MoneyField
                label="手動分攤成本"
                path={`items.${item.id}.manualAmount`}
                value={item.manualAmount}
                onChange={(manualAmount) => patchItem(item.id, { manualAmount })}
                issues={issues}
              />
            )}
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800" aria-live="polite">
        <dl className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex justify-between gap-4">
            {/* Derived from the lines, never typed — the old form asked for this
                number and then checked the user's arithmetic against its own. */}
            <dt>商品小計（自動加總）</dt>
            <dd className="tabular-nums">{derivedSubtotal?.toFixed(2) ?? '—'}</dd>
          </div>
          {itemized && (
            <div className="flex justify-between gap-4">
              <dt>溢價・工錢・稅費・其他</dt>
              <dd className="tabular-nums">{itemizedExtras?.toFixed(2) ?? '—'}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt>運費 − 折扣</dt>
            <dd className="tabular-nums">{shippingLessDiscount?.toFixed(2) ?? '—'}</dd>
          </div>
        </dl>
        <div className="mt-3 border-t border-slate-300 pt-3 dark:border-slate-600">
          <span className="text-sm text-slate-600 dark:text-slate-300">預估付款總額</span>
          <p className="mt-1 break-words text-2xl font-semibold tabular-nums">
            {total === null ? '—' : total.toFixed(2)}
          </p>
        </div>
      </div>
    </section>
  );
}

function MoneyField(props: {
  label: string;
  path: string;
  value: string;
  onChange: (value: string) => void;
  issues: readonly WizardValidationIssue[];
}) {
  return <WizardField {...props} type="number" min="0" step="0.01" inputMode="decimal" required />;
}

/** Adds decimal strings, returning null if any is not yet a usable number. */
export function sumMoney(values: readonly string[]): Decimal | null {
  try {
    return values.reduce((sum, value) => sum.plus(new Decimal(value || '0')), new Decimal(0));
  } catch {
    return null;
  }
}

/**
 * Costs as they will actually be submitted, for preview purposes: derived
 * subtotal, and itemized-only charges zeroed in SIMPLE mode.
 */
export function resolveCostsFor(costs: WizardCosts, derivedSubtotal: Decimal | null): WizardCosts {
  const subtotal = derivedSubtotal === null ? costs.subtotal : derivedSubtotal.toFixed(2);
  if (costs.mode !== 'SIMPLE') return { ...costs, subtotal };
  return { ...costs, subtotal, premium: '0', labor: '0', tax: '0', otherFees: '0' };
}

export function purchaseTotalPreview(costs: WizardCosts): Decimal | null {
  try {
    return new Decimal(costs.subtotal)
      .plus(costs.premium)
      .plus(costs.labor)
      .plus(costs.tax)
      .plus(costs.shipping)
      .plus(costs.otherFees)
      .minus(costs.discount);
  } catch {
    return null;
  }
}

export function ReviewStep({ draft }: { draft: PurchaseWizardDraft }) {
  const total = purchaseTotalPreview(draft.costs);
  return (
    <section aria-labelledby="wizard-review-heading" className="space-y-4">
      <div>
        <h2 id="wizard-review-heading" className="text-xl font-semibold">
          確認入庫
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          請核對交易、重量與附件。送出後會沿用現有交易冪等保護，避免重複入庫。
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReviewCard title="交易">
          <Description label="購買時間" value={formatDateTime(draft.transaction.purchasedAt)} />
          <Description label="商家" value={draft.transaction.dealerName || '未填'} />
          <Description label="幣別" value={draft.transaction.currency} />
          <Description
            label="付款方式"
            value={paymentMethodLabel(draft.transaction.paymentMethod)}
          />
          <Description
            label="總額"
            value={
              total === null ? '資料有誤' : `${draft.transaction.currency} ${total.toFixed(2)}`
            }
          />
        </ReviewCard>
        <ReviewCard title="附件完整度">
          <Description label="商品照片" value={`${draft.photos.length} 張`} />
          <Description label="文件" value={`${draft.documents.length} 份`} />
          {draft.photos.length === 0 && <MissingNotice>尚未加入商品照片</MissingNotice>}
          {draft.documents.length === 0 && <MissingNotice>文件待補</MissingNotice>}
          {[...draft.photos, ...draft.documents].some(
            ({ needsReselection }) => needsReselection,
          ) && <MissingNotice>部分本機原檔需要重新選擇</MissingNotice>}
        </ReviewCard>
      </div>
      <ReviewCard title={`商品（${draft.items.length} 項）`}>
        <ol className="divide-y divide-slate-200 dark:divide-slate-700">
          {draft.items.map((item, index) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    {index + 1}. {item.name}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {item.metalCode} · {item.quantity} × {item.unitWeight}{' '}
                    {WEIGHT_UNIT_LABELS[item.weightUnit]} · 純度 {item.purity}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">
                  {draft.transaction.currency} {item.lineSubtotal}
                </span>
              </div>
              {item.organizations.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1 text-xs text-slate-500 dark:text-slate-400">
                  {item.organizations.map((organization) => (
                    <li
                      key={organization.id}
                      className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800"
                    >
                      {ORGANIZATION_ROLE_LABELS[organization.role]}：{organization.displayName}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </ReviewCard>
      <p className="rounded-xl border border-slate-300 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
        附件不是完成交易的必要條件；缺少的照片與文件會保留為待補狀態，不會偽裝成已歸檔。
      </p>
    </section>
  );
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface min-w-0 rounded-xl p-4">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Description({ label, value }: { label: string; value: string }) {
  return (
    <dl className="flex min-w-0 items-start justify-between gap-3 text-sm">
      <dt className="shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </dl>
  );
}

function MissingNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      {children}
    </p>
  );
}

function SmallAction({
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
