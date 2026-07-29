import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { api, isApiError, type Metal, type ProductDefinition } from '../api.js';
import { CustomSelect } from '../CustomSelect.js';
import { searchOrganizationCatalog } from '../organization-search-provider.js';
import { productFormLabel, productFormOptions } from '../product-forms.js';
import { OrganizationCombobox } from '../purchase-wizard/organization-search.js';
import type { OrganizationSearchProvider, WizardOrganization } from '../purchase-wizard/types.js';
import { COUNTRY_OPTIONS, type ReferenceOption } from '../reference-options.js';
import { SearchableSelect } from '../SearchableSelect.js';
import { WEIGHT_UNITS, WEIGHT_UNIT_LABELS, formatGrams, type WeightUnit } from '../units.js';
import {
  buildProductPatch,
  convertWeightDisplay,
  emptyProductEditForm,
  filterProductDefinitions,
  formatProductPurity,
  groupProductDefinitionsByMetal,
  productPartiesWithBrand,
  safeDecimalString,
  validateProductDraft,
  validateProductEditForm,
  type ProductEditForm,
} from './products-model.js';

const OPTIONAL_COUNTRY_OPTIONS: readonly ReferenceOption[] = [
  { value: '', label: '未指定' },
  ...COUNTRY_OPTIONS,
];

export function ProductsScreen() {
  const queryClient = useQueryClient();
  const metals = useQuery<Metal[]>({
    queryKey: ['metals'],
    queryFn: () => api.get<Metal[]>('/metals'),
  });
  const products = useQuery<ProductDefinition[]>({
    queryKey: ['products'],
    queryFn: () => api.get<ProductDefinition[]>('/product-definitions'),
  });

  const [name, setName] = useState('');
  const [metalCode, setMetalCode] = useState('');
  const [form, setForm] = useState('bar');
  const [brandOrganization, setBrandOrganization] = useState<WizardOrganization | null>(null);
  const [country, setCountry] = useState('');
  const [yearOrVersion, setYearOrVersion] = useState('');
  const [purity, setPurity] = useState('0.9999');
  const [unitWeight, setUnitWeight] = useState('1');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('g');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState(false);

  useEffect(() => {
    if (!metalCode && metals.data?.[0]) {
      setMetalCode(metals.data.find((metal) => metal.code === 'XAU')?.code ?? metals.data[0].code);
    }
  }, [metalCode, metals.data]);

  const create = useMutation({
    mutationFn: () =>
      api.post<ProductDefinition>('/product-definitions', {
        name: name.trim(),
        metalCode,
        form,
        parties: brandOrganization
          ? [
              {
                organizationId: brandOrganization.id,
                role: 'BRAND',
                isPrimary: true,
                attributionStatus: 'DECLARED',
              },
            ]
          : undefined,
        country: country.trim() || undefined,
        yearOrVersion: yearOrVersion.trim() || undefined,
        purity,
        unitWeight,
        weightUnit,
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      setSuccess(`已建立「${created.name}」，新增入庫時可以直接套用。`);
      setName('');
      setBrandOrganization(null);
      setCountry('');
      setYearOrVersion('');
    },
    onError: (requestError) => {
      setError(requestError instanceof Error ? requestError.message : '無法建立商品規格。');
    },
  });

  const edit = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch<ProductDefinition>(`/product-definitions/${id}`, patch),
    onSuccess: async (updated) => {
      setError(null);
      setEditConflict(false);
      queryClient.setQueryData<ProductDefinition[]>(['products'], (current) =>
        current?.map((p) => (p.id === updated.id ? updated : p)),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
      setEditingId(null);
    },
    onError: (requestError) => {
      setEditConflict(isApiError(requestError) && requestError.status === 409);
      setError(requestError instanceof Error ? requestError.message : '無法更新商品規格。');
    },
  });

  const visibleProducts = useMemo(
    () => filterProductDefinitions(products.data ?? [], query),
    [products.data, query],
  );
  const productGroups = useMemo(
    () => groupProductDefinitionsByMetal(visibleProducts),
    [visibleProducts],
  );

  if (metals.isPending || products.isPending) {
    return <PageState message="正在讀取商品規格庫…" />;
  }
  if (metals.isError || products.isError) {
    const message = metals.error?.message ?? products.error?.message ?? '未知錯誤';
    return (
      <PageState
        message={`無法讀取商品規格庫：${message}`}
        retry={() => {
          void metals.refetch();
          void products.refetch();
        }}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">商品規格庫</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          儲存常買的金條、銀條、金幣或銀幣規格。黃金與白銀會分開顯示；之後新增入庫時選取模板，就會自動帶入金屬、形式、純度與重量。這裡不是實際庫存數量。
        </p>
      </div>

      <section className="surface rounded-xl p-4" aria-labelledby="new-product-heading">
        <div className="mb-4">
          <h2 id="new-product-heading" className="font-semibold">
            新增常用商品規格
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            例如：PAMP Lady Fortuna 10g 金條。品牌可從 PAMP、UBS 等鑄幣廠／精煉廠目錄中搜尋選取。
          </p>
        </div>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setSuccess(null);
            const validationError = validateProductDraft({
              name,
              metalCode,
              form,
              purity,
              unitWeight,
            });
            if (validationError) {
              setError(validationError);
              return;
            }
            create.mutate();
          }}
        >
          <Input label="規格名稱" value={name} onChange={setName} placeholder="PAMP 10g 金條" />
          <CustomSelect
            label="金屬"
            value={metalCode}
            onChange={setMetalCode}
            options={[
              { value: '', label: '請選擇' },
              ...metals.data.map((metal) => ({
                value: metal.code,
                label: `${metal.code} — ${metal.name}`,
              })),
            ]}
          />
          <CustomSelect
            label="形式"
            value={form}
            onChange={setForm}
            options={productFormOptions(metalCode).map(([value, label]) => ({ value, label }))}
          />
          <ProductBrandSelect
            selectedName={brandOrganization?.canonicalName ?? ''}
            searchProvider={searchOrganizationCatalog}
            onSelect={setBrandOrganization}
            onClear={() => setBrandOrganization(null)}
          />
          <SearchableSelect
            label="國家或地區（選填）"
            value={country}
            onChange={setCountry}
            options={OPTIONAL_COUNTRY_OPTIONS}
            placeholder="未指定"
            searchPlaceholder="搜尋代碼、中文、英文或別名"
          />
          <Input
            label="年份／版本（選填）"
            value={yearOrVersion}
            onChange={setYearOrVersion}
            placeholder="2026"
          />
          <Input
            label="純度（0–1）"
            type="number"
            inputMode="decimal"
            min="0.0000001"
            max="1"
            step="any"
            value={purity}
            onChange={setPurity}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <Input
              label="單件重量"
              type="number"
              inputMode="decimal"
              min="0.000000001"
              step="any"
              value={unitWeight}
              onChange={setUnitWeight}
            />
            <CustomSelect
              label="單位"
              value={weightUnit}
              onChange={(nextValue) => setWeightUnit(nextValue as WeightUnit)}
              options={WEIGHT_UNITS.map((unit) => ({
                value: unit,
                label: WEIGHT_UNIT_LABELS[unit],
              }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-lg bg-accent px-5 py-2 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
            >
              {create.isPending ? '建立中…' : '建立商品規格'}
            </button>
            {error && (
              <span role="alert" className="text-danger text-sm">
                {error}
              </span>
            )}
            {success && (
              <span
                role="status"
                className="text-sm font-medium text-emerald-700 dark:text-emerald-300"
              >
                {success}
              </span>
            )}
          </div>
        </form>
      </section>

      <section aria-labelledby="saved-products-heading" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="saved-products-heading" className="font-semibold">
              已儲存規格
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              共 {products.data.length} 筆
            </p>
          </div>
          {products.data.length > 0 && (
            <label className="block w-full text-sm sm:w-72">
              <span className="sr-only">搜尋商品規格</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋名稱、品牌或金屬"
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
          )}
        </div>

        {products.data.length === 0 ? (
          <div className="surface rounded-xl px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-300">
            尚未建立商品規格。上方建立後，就能在入庫 Wizard 中直接選用。
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="surface rounded-xl px-4 py-8 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-300">找不到符合的商品規格。</p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-2 rounded-lg px-4 font-medium text-accent underline-offset-4 hover:underline dark:text-teal-400"
            >
              清除搜尋
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {productGroups.map((group) => (
              <section
                key={group.metalCode}
                aria-labelledby={`product-group-${group.metalCode}`}
                className="min-w-0 space-y-2"
              >
                <div className="flex items-center gap-2 px-1">
                  <h3 id={`product-group-${group.metalCode}`} className="font-semibold">
                    {productMetalGroupLabel(group.metalCode, group.metalName)}
                  </h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {group.products.length} 筆
                  </span>
                </div>
                <ProductList
                  products={group.products}
                  editingId={editingId}
                  onEdit={(id) => {
                    setError(null);
                    setEditConflict(false);
                    setEditingId(id);
                  }}
                  onSave={(id, patch) => edit.mutate({ id, patch })}
                  serverError={error}
                  serverConflict={editConflict}
                  isPending={edit.isPending}
                  onClearError={() => setError(null)}
                />
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProductList({
  products,
  editingId,
  onEdit,
  onSave,
  serverError,
  serverConflict,
  isPending,
  onClearError,
}: {
  products: readonly ProductDefinition[];
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onSave: (id: string, patch: Record<string, unknown>) => void;
  serverError?: string | null;
  serverConflict?: boolean;
  isPending?: boolean;
  onClearError?: () => void;
}) {
  const editingProduct = products.find((product) => product.id === editingId);

  return (
    <div className="space-y-3">
      {editingProduct && (
        <ProductEditCard
          key={editingProduct.id}
          product={editingProduct}
          onSave={(patch) => onSave(editingProduct.id, patch)}
          onCancel={() => onEdit(null)}
          serverError={serverError}
          serverConflict={serverConflict}
          isPending={isPending}
          onClearError={onClearError}
        />
      )}

      <div className="space-y-3 md:hidden">
        {products
          .filter((product) => product.id !== editingId)
          .map((product) => (
            <MobileProductCard
              key={product.id}
              product={product}
              onEdit={() => onEdit(product.id)}
              isPending={isPending}
            />
          ))}
      </div>

      <div className="surface hidden overflow-hidden rounded-xl md:block">
        <table className="w-full table-fixed text-sm">
          <thead className="text-left text-slate-500 dark:text-slate-400">
            <tr>
              <th scope="col" className="w-[27%] p-3">
                名稱
              </th>
              <th scope="col" className="w-[11%] p-3">
                金屬
              </th>
              <th scope="col" className="w-[15%] p-3">
                形式
              </th>
              <th scope="col" className="w-[18%] p-3">
                品牌／來源
              </th>
              <th scope="col" className="w-[13%] p-3">
                純度
              </th>
              <th scope="col" className="w-[16%] p-3">
                單件重量
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t border-slate-200 dark:border-slate-700">
                <td className="break-words p-3 font-medium [overflow-wrap:anywhere]">
                  {product.name}
                </td>
                <td className="p-3">{product.metal.code}</td>
                <td className="break-words p-3">
                  {productFormLabel(product.form, product.metal.code)}
                </td>
                <td className="break-words p-3 [overflow-wrap:anywhere]">
                  {[product.brand, product.country].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="p-3">{formatProductPurity(product.defaultPurity)}</td>
                <td className="break-words p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>{formatProductWeight(product)}</span>
                    <button
                      type="button"
                      onClick={() => onEdit(product.id)}
                      disabled={isPending}
                      className="shrink-0 min-h-[44px] min-w-[44px] rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-teal-50 disabled:opacity-50 dark:hover:bg-teal-950"
                    >
                      編輯
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function productMetalGroupLabel(metalCode: string, metalName: string): string {
  if (metalCode === 'XAU') return '黃金商品';
  if (metalCode === 'XAG') return '白銀商品';
  return `${metalName}商品`;
}

function formatProductWeight(product: ProductDefinition): string {
  const grams = safeDecimalString(product.defaultUnitWeightGrams);
  return grams === null ? '—' : formatGrams(grams, 'g');
}

function Input({
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
  inputMode?: 'decimal';
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

function MobileProductCard({
  product,
  onEdit,
  isPending,
}: {
  product: ProductDefinition;
  onEdit: () => void;
  isPending?: boolean;
}) {
  return (
    <article className="surface rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-semibold [overflow-wrap:anywhere]">{product.name}</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {[product.brand, product.country, product.yearOrVersion].filter(Boolean).join(' · ') ||
              '未設定品牌'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-300">
            {product.metal.code}
          </span>
          <button
            type="button"
            onClick={onEdit}
            disabled={isPending}
            className="min-h-[44px] min-w-[44px] text-xs font-medium text-accent hover:underline disabled:opacity-50"
          >
            編輯
          </button>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <ProductMetric label="形式" value={productFormLabel(product.form, product.metal.code)} />
        <ProductMetric label="純度" value={formatProductPurity(product.defaultPurity)} />
        <ProductMetric label="單件重量" value={formatProductWeight(product)} />
        <ProductMetric label="狀態" value={product.active ? '可使用' : '已停用'} />
      </dl>
    </article>
  );
}

function ProductEditCard({
  product,
  onSave,
  onCancel,
  serverError,
  serverConflict,
  isPending,
  onClearError,
}: {
  product: ProductDefinition;
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
  serverError?: string | null;
  serverConflict?: boolean;
  isPending?: boolean;
  onClearError?: () => void;
}) {
  return (
    <div className="surface rounded-xl p-4">
      <ProductEditForm
        product={product}
        onSave={onSave}
        onCancel={onCancel}
        serverError={serverError}
        serverConflict={serverConflict}
        isPending={isPending}
        onClearError={onClearError}
      />
    </div>
  );
}

function ProductEditForm({
  product,
  onSave,
  onCancel,
  serverError,
  serverConflict,
  isPending,
  onClearError,
}: {
  product: ProductDefinition;
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
  serverError?: string | null;
  serverConflict?: boolean;
  isPending?: boolean;
  onClearError?: () => void;
}) {
  const base = useRef(product).current;
  const [form, setForm] = useState<ProductEditForm>(() => emptyProductEditForm(base));
  const baseBrandParty = useMemo(
    () =>
      base.organizations?.find(({ role, isPrimary }) => role === 'BRAND' && isPrimary) ??
      base.organizations?.find(({ role }) => role === 'BRAND'),
    [base],
  );
  const [brandOrganization, setBrandOrganization] = useState<WizardOrganization | null>(() =>
    baseBrandParty
      ? {
          id: baseBrandParty.organization.id,
          canonicalName: baseBrandParty.organization.canonicalName,
          countryCode: baseBrandParty.organization.countryCode ?? undefined,
          aliases: [],
          capabilities: ['BRAND'],
        }
      : null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const isStale = product.version !== base.version;

  const isConflict = isStale || Boolean(serverConflict);
  const canSave = !isPending && !isConflict;

  const handleChange = (field: keyof ProductEditForm, value: string | boolean) => {
    if (!isConflict) {
      setLocalError(null);
      onClearError?.();
    }
    if (field === 'weightUnit') {
      setForm((prev) => {
        const oldUnit = prev.weightUnit;
        const newUnit = value as string;
        try {
          const converted = convertWeightDisplay(prev.unitWeight, oldUnit, newUnit);
          return { ...prev, unitWeight: converted, weightUnit: newUnit };
        } catch {
          return { ...prev, weightUnit: newUnit };
        }
      });
    } else if (field === 'unitWeight') {
      setForm((prev) => ({ ...prev, unitWeight: value as string, weightUnitDirty: true }));
    } else {
      setForm((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleReload = async () => {
    await queryClient.invalidateQueries({ queryKey: ['products'] });
    onCancel();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setLocalError(null);
    const validationError = validateProductEditForm(form);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    const patch = buildProductPatch(base, form);
    const originalBrandOrganizationId = baseBrandParty?.organization.id ?? null;
    const selectedBrandOrganizationId = brandOrganization?.id ?? null;
    if (originalBrandOrganizationId !== selectedBrandOrganizationId) {
      patch.parties = productPartiesWithBrand(base, selectedBrandOrganizationId);
      patch.brand = brandOrganization?.canonicalName ?? null;
    }
    if (Object.keys(patch).length <= 1) {
      onCancel();
      return;
    }
    onSave(patch);
  };

  const displayError = isConflict
    ? (serverError ?? '此規格已被其他操作更新，無法儲存。')
    : serverError || localError;

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-3">
      <fieldset disabled={isPending}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ProductEditInput
            label="名稱"
            value={form.name}
            onChange={(v) => handleChange('name', v)}
          />
          <ProductEditSelect
            label="形式"
            value={form.form}
            options={productFormOptions(base.metal.code)}
            onChange={(v) => handleChange('form', v)}
            disabled={isPending}
          />
          <ProductBrandSelect
            selectedName={brandOrganization?.canonicalName ?? form.brand}
            searchProvider={searchOrganizationCatalog}
            onSelect={(organization) => {
              setBrandOrganization(organization);
              handleChange('brand', organization.canonicalName);
            }}
            onClear={() => {
              setBrandOrganization(null);
              handleChange('brand', '');
            }}
            disabled={isPending}
            legacy={!brandOrganization && Boolean(form.brand)}
          />
          <SearchableSelect
            label="國家"
            value={form.country}
            onChange={(v) => handleChange('country', v)}
            options={OPTIONAL_COUNTRY_OPTIONS}
            placeholder="未指定"
            searchPlaceholder="搜尋代碼、中文、英文或別名"
            disabled={isPending}
          />
          <ProductEditInput
            label="年份"
            value={form.yearOrVersion}
            onChange={(v) => handleChange('yearOrVersion', v)}
          />
          <ProductEditInput
            label="純度"
            type="number"
            inputMode="decimal"
            min="0.0000001"
            max="1"
            step="any"
            value={form.purity}
            onChange={(v) => handleChange('purity', v)}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <ProductEditInput
              label="單件重量"
              type="number"
              inputMode="decimal"
              min="0.000000001"
              step="any"
              value={form.unitWeight}
              onChange={(v) => handleChange('unitWeight', v)}
            />
            <ProductEditSelect
              label="單位"
              value={form.weightUnit}
              options={WEIGHT_UNITS.map((u) => [u, WEIGHT_UNIT_LABELS[u]])}
              onChange={(v) => handleChange('weightUnit', v)}
              disabled={isPending}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => handleChange('active', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="font-medium">啟用</span>
          </label>
          <div className="text-xs text-slate-400 self-end pb-1">
            金屬：{base.metal.code}（不可修改）
          </div>
        </div>
      </fieldset>
      {displayError && (
        <p
          role="alert"
          className={
            isConflict
              ? 'text-sm font-semibold text-red-700 dark:text-red-300'
              : 'text-danger text-sm'
          }
        >
          {displayError}
        </p>
      )}
      {isConflict && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            此規格已被其他操作更新，請重新載入最新資料。
          </p>
          <button
            type="button"
            onClick={handleReload}
            className="mt-2 min-h-[44px] min-w-[44px] rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700"
          >
            放棄編輯並重新載入
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSave}
          className="min-h-[44px] min-w-[44px] rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
        >
          {isPending ? '儲存中…' : '儲存'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="min-h-[44px] min-w-[44px] rounded-lg border px-4 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
        >
          取消
        </button>
      </div>
    </form>
  );
}

function ProductBrandSelect({
  selectedName,
  searchProvider,
  onSelect,
  onClear,
  disabled,
  legacy = false,
}: {
  selectedName: string;
  searchProvider: OrganizationSearchProvider;
  onSelect: (organization: WizardOrganization) => void;
  onClear: () => void;
  disabled?: boolean;
  legacy?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <OrganizationCombobox
        role="BRAND"
        label={selectedName ? '更換品牌／鑄幣廠' : '品牌／鑄幣廠（選填）'}
        placeholder="搜尋 PAMP、UBS 或其他品牌"
        searchProvider={searchProvider}
        onSelect={onSelect}
        allowCustom={false}
        disabled={disabled}
      />
      {selectedName ? (
        <div className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border border-teal-300 bg-teal-50 pl-3 text-sm dark:border-teal-800 dark:bg-teal-950">
          <span className="min-w-0 break-words font-medium">
            已選：{selectedName}
            {legacy ? '（既有文字，請重新選擇以連結品牌目錄）' : ''}
          </span>
          <button
            type="button"
            className="min-h-11 min-w-11 shrink-0 rounded-lg text-danger"
            aria-label={`清除品牌 ${selectedName}`}
            disabled={disabled}
            onClick={onClear}
          >
            ×
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          可用正式名稱或別名搜尋；資料會連結到品牌目錄。
        </p>
      )}
    </div>
  );
}

function ProductEditInput({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  min,
  max,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: 'decimal';
  min?: string;
  max?: string;
  step?: string;
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ProductEditSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <CustomSelect
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={options.map(([optionValue, optionLabel]) => ({
        value: optionValue,
        label: optionLabel,
      }))}
    />
  );
}

function ProductMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="break-words font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function PageState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="py-10 text-center">
      <p className="text-slate-600 dark:text-slate-300">{message}</p>
      {retry && (
        <button
          type="button"
          className="mt-2 rounded-lg px-4 font-medium text-accent underline-offset-4 hover:underline dark:text-teal-400"
          onClick={retry}
        >
          重試
        </button>
      )}
    </div>
  );
}
