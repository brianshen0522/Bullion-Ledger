import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { api, isApiError, type Metal, type ProductDefinition } from '../api.js';
import { CustomSelect } from '../CustomSelect.js';
import { SearchableSelect } from '../SearchableSelect.js';
import { WizardBack, WizardNext, WizardShell, WizardSubmit } from '../WizardShell.js';
import { OrganizationCombobox } from '../purchase-wizard/organization-search.js';
import type { WizardOrganization } from '../purchase-wizard/types.js';
import { searchOrganizationCatalog } from '../organization-search-provider.js';
import { productFormLabel, productFormOptions } from '../product-forms.js';
import { COUNTRY_OPTIONS, type ReferenceOption } from '../reference-options.js';
import { WEIGHT_UNITS, WEIGHT_UNIT_LONG_LABELS } from '@bullion-ledger/shared';
import {
  buildProductCreateBody,
  buildProductPatch,
  convertWeightDisplay,
  formatProductPurity,
  newProductWizardForm,
  productPartiesWithBrand,
  productWizardFormFrom,
  validateProductStep,
  type ProductWizardForm,
} from './products-model.js';
import {
  PRODUCT_WIZARD_STEPS,
  nextProductStep,
  previousProductStep,
  productStepIndex,
  productStepLabel,
  type ProductWizardStep,
} from './products-route.js';

const OPTIONAL_COUNTRY_OPTIONS: readonly ReferenceOption[] = [
  { value: '', label: '未指定' },
  ...COUNTRY_OPTIONS,
];

interface ProductWizardProps {
  /** Null when creating; the specification being corrected otherwise. */
  product: ProductDefinition | null;
  metals: readonly Metal[];
  step: ProductWizardStep;
  onStep: (step: ProductWizardStep) => void;
  onDone: (product: ProductDefinition) => void;
  onCancel: () => void;
}

/**
 * Creating and editing a specification, as one full-screen flow.
 *
 * The create form used to sit permanently expanded above the list: eight fields
 * stacked on a phone, so the catalogue itself started most of a screen down.
 * Editing was an inline card in the list, which shoved the rows around. Both
 * are the same handful of fields, so both are this.
 */
export function ProductWizard({
  product,
  metals,
  step,
  onStep,
  onDone,
  onCancel,
}: ProductWizardProps) {
  const editing = product !== null;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductWizardForm>(() =>
    product
      ? productWizardFormFrom(product)
      : newProductWizardForm(
          metals.find((metal) => metal.code === 'XAU')?.code ?? metals[0]?.code ?? '',
        ),
  );

  const originalBrandParty = useMemo(
    () =>
      product?.organizations?.find(({ role, isPrimary }) => role === 'BRAND' && isPrimary) ??
      product?.organizations?.find(({ role }) => role === 'BRAND'),
    [product],
  );
  const [brand, setBrand] = useState<WizardOrganization | null>(() =>
    originalBrandParty
      ? {
          id: originalBrandParty.organization.id,
          canonicalName: originalBrandParty.organization.canonicalName,
          countryCode: originalBrandParty.organization.countryCode ?? undefined,
          aliases: [],
          capabilities: ['BRAND'],
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [baseVersion] = useState(() => product?.version ?? 0);

  const stepIndex = productStepIndex(step);
  // A specification that moved on under an open editor cannot be patched
  // against the version this form was built from.
  const stale = editing && product.version !== baseVersion;

  function patch<K extends keyof ProductWizardForm>(key: K, value: ProductWizardForm[K]) {
    setError(null);
    setForm((previous) => {
      if (key === 'weightUnit') {
        const nextUnit = value as string;
        try {
          return {
            ...previous,
            unitWeight: convertWeightDisplay(previous.unitWeight, previous.weightUnit, nextUnit),
            weightUnit: nextUnit,
            weightUnitDirty: true,
          };
        } catch {
          return { ...previous, weightUnit: nextUnit, weightUnitDirty: true };
        }
      }
      if (key === 'unitWeight') {
        return { ...previous, unitWeight: value as string, weightUnitDirty: true };
      }
      return { ...previous, [key]: value };
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) {
        return api.post<ProductDefinition>(
          '/product-definitions',
          buildProductCreateBody(form, brand?.id ?? null),
        );
      }
      const body = buildProductPatch(product, form);
      const originalBrandId = originalBrandParty?.organization.id ?? null;
      if (originalBrandId !== (brand?.id ?? null)) {
        body.parties = productPartiesWithBrand(product, brand?.id ?? null);
        body.brand = brand?.canonicalName ?? null;
      }
      if (Object.keys(body).length <= 1) return product;
      return api.patch<ProductDefinition>(
        `/product-definitions/${encodeURIComponent(product.id)}`,
        body,
      );
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        // A catalog edit is what every linked holding inherits.
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
      onDone(saved);
    },
    onError: (requestError) => {
      setError(
        isApiError(requestError) && requestError.status === 409
          ? '此規格已被其他操作更新，請重新載入後再試。'
          : requestError instanceof Error
            ? requestError.message
            : '無法儲存商品規格。',
      );
    },
  });

  function goNext() {
    const issue = validateProductStep(form, step);
    if (issue) {
      setError(issue);
      return;
    }
    const next = nextProductStep(step);
    if (next) onStep(next);
  }

  const metalName = metals.find((metal) => metal.code === form.metalCode)?.name ?? form.metalCode;

  return (
    <WizardShell
      eyebrow={editing ? '編輯商品規格' : '新增商品規格'}
      subject={editing ? product.name : '新增商品規格'}
      stepLabel={productStepLabel(step)}
      stepIndex={stepIndex}
      stepCount={PRODUCT_WIZARD_STEPS.length}
      scrollKey={step}
      busy={save.isPending}
      onCancel={onCancel}
      onSubmit={() => {
        if (step !== 'review' || save.isPending) return;
        const issue = validateProductStep(form, 'review');
        if (issue) {
          setError(issue);
          return;
        }
        save.mutate();
      }}
      error={
        error || stale ? (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-danger dark:bg-red-950"
          >
            {stale ? '此規格已被其他操作更新，請重新載入後再試。' : error}
          </p>
        ) : null
      }
      footer={
        <>
          <WizardBack
            disabled={stepIndex === 0 || save.isPending}
            onClick={() => {
              const previous = previousProductStep(step);
              if (previous) onStep(previous);
            }}
          />
          {step === 'review' ? (
            <WizardSubmit
              busy={save.isPending}
              idle={editing ? '確認並儲存' : '建立規格'}
              working="正在儲存…"
            />
          ) : (
            <WizardNext onClick={goNext} />
          )}
        </>
      }
    >
      {step === 'basics' && (
        <section className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            規格是入庫時可以套用的模板，不是實際庫存數量。例如：PAMP Lady Fortuna 10g 金條。
          </p>
          <div className="surface rounded-xl p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="規格名稱"
                value={form.name}
                onChange={(value) => patch('name', value)}
                placeholder="PAMP 10g 金條"
              />
              {editing ? (
                <div className="min-w-0">
                  <p className="text-sm font-medium">金屬</p>
                  <p className="mt-1.5 min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">
                    {form.metalCode} — {metalName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    已建立的規格不能換金屬，既有庫存都是以這個金屬計價的。
                  </p>
                </div>
              ) : (
                <CustomSelect
                  label="金屬"
                  value={form.metalCode}
                  onChange={(value) => patch('metalCode', value)}
                  options={metals.map((metal) => ({
                    value: metal.code,
                    label: `${metal.code} — ${metal.name}`,
                  }))}
                />
              )}
              <CustomSelect
                label="形式"
                value={form.form}
                onChange={(value) => patch('form', value)}
                options={productFormOptions(form.metalCode).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              {editing && (
                <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={form.active}
                    onChange={(event) => patch('active', event.target.checked)}
                  />
                  <span className="font-medium">在入庫時可選用</span>
                </label>
              )}
            </div>
          </div>
        </section>
      )}

      {step === 'origin' && (
        <section className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            全部選填。品牌會連結到鑄幣廠／精煉廠目錄，之後可以用它搜尋庫存。
          </p>
          <div className="surface space-y-4 rounded-xl p-4">
            <div className="min-w-0 space-y-2">
              <OrganizationCombobox
                role="BRAND"
                label={brand ? '更換品牌／鑄幣廠' : '品牌／鑄幣廠（選填）'}
                placeholder="搜尋 PAMP、UBS 或其他品牌"
                searchProvider={searchOrganizationCatalog}
                onSelect={setBrand}
                allowCustom={false}
              />
              {brand && (
                <div className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border border-teal-300 bg-teal-50 pl-3 text-sm dark:border-teal-800 dark:bg-teal-950">
                  <span className="min-w-0 break-words font-medium">
                    已選：{brand.canonicalName}
                  </span>
                  <button
                    type="button"
                    className="min-h-11 min-w-11 shrink-0 rounded-lg text-danger"
                    aria-label={`清除品牌 ${brand.canonicalName}`}
                    onClick={() => setBrand(null)}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SearchableSelect
                label="國家或地區（選填）"
                value={form.country}
                onChange={(value) => patch('country', value)}
                options={OPTIONAL_COUNTRY_OPTIONS}
                placeholder="未指定"
                searchPlaceholder="搜尋代碼、中文、英文或別名"
              />
              <Field
                label="年份／版本（選填）"
                value={form.yearOrVersion}
                onChange={(value) => patch('yearOrVersion', value)}
                placeholder="2026"
              />
            </div>
          </div>
        </section>
      )}

      {step === 'spec' && (
        <section className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            入庫時會自動帶入這裡的純度與重量，之後仍可以在該批庫存上改。
          </p>
          <div className="surface rounded-xl p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="純度（0–1）"
                type="number"
                inputMode="decimal"
                min="0.0000001"
                max="1"
                step="any"
                value={form.purity}
                onChange={(value) => patch('purity', value)}
              />
              <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-[minmax(0,1fr)_9rem]">
                <Field
                  label="單件重量"
                  type="number"
                  inputMode="decimal"
                  min="0.000000001"
                  step="any"
                  value={form.unitWeight}
                  onChange={(value) => patch('unitWeight', value)}
                />
                <CustomSelect
                  label="重量單位"
                  value={form.weightUnit}
                  onChange={(value) => patch('weightUnit', value)}
                  options={WEIGHT_UNITS.map((unit) => ({
                    value: unit,
                    label: WEIGHT_UNIT_LONG_LABELS[unit],
                  }))}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 'review' && (
        <section className="space-y-4">
          <div className="surface rounded-xl p-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Fact label="規格名稱" value={form.name || '未填寫'} />
              <Fact label="金屬" value={`${form.metalCode} — ${metalName}`} />
              <Fact label="形式" value={productFormLabel(form.form, form.metalCode)} />
              <Fact label="品牌" value={brand?.canonicalName ?? '未指定'} />
              <Fact label="國家" value={form.country || '未指定'} />
              <Fact label="年份／版本" value={form.yearOrVersion || '未指定'} />
              <Fact label="純度" value={formatProductPurity(form.purity)} />
              <Fact label="單件重量" value={`${form.unitWeight} ${form.weightUnit}`} />
              {editing && <Fact label="可選用" value={form.active ? '是' : '否'} />}
            </dl>
          </div>
          {editing && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              已連結這個規格的庫存會跟著更新，除非該批已經自行覆寫過該欄位。
            </p>
          )}
        </section>
      )}
    </WizardShell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  min,
  max,
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: 'decimal' | 'numeric';
  min?: string;
  max?: string;
  step?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="w-full rounded-lg border px-3 py-2"
        type={type}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="break-words font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
