import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, type Metal, type ProductDefinition } from '../api.js';
import { productFormLabel } from '../product-forms.js';
import { formatGrams } from '../units.js';
import { ProductWizard } from './ProductWizard.js';
import {
  filterProductDefinitions,
  formatProductPurity,
  groupProductDefinitionsByMetal,
  safeDecimalString,
} from './products-model.js';
import {
  FIRST_PRODUCT_STEP,
  readProductsView,
  urlForProductsView,
  type ProductsView,
} from './products-route.js';

export function ProductsScreen() {
  const metals = useQuery<Metal[]>({
    queryKey: ['metals'],
    queryFn: () => api.get<Metal[]>('/metals'),
  });
  const products = useQuery<ProductDefinition[]>({
    queryKey: ['products'],
    queryFn: () => api.get<ProductDefinition[]>('/product-definitions'),
  });

  const [query, setQuery] = useState('');
  const [view, setView] = useState<ProductsView>(() => readProductsView(window.location.search));
  const [notice, setNotice] = useState<string | null>(null);

  // The open specification lives in the URL, so back leaves the wizard and a
  // reload keeps the panel the user was on.
  const navigate = useCallback((next: ProductsView, mode: 'push' | 'replace' = 'push') => {
    window.history[mode === 'replace' ? 'replaceState' : 'pushState'](
      { ...(window.history.state as object | null) },
      '',
      urlForProductsView(window.location.href, next),
    );
    setView(next);
  }, []);

  useEffect(() => {
    const onPopState = () => setView(readProductsView(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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

  const editingProduct =
    view.kind === 'edit'
      ? (products.data.find((product) => product.id === view.productId) ?? null)
      : null;

  if (view.kind === 'create' || (view.kind === 'edit' && editingProduct)) {
    return (
      <ProductWizard
        product={editingProduct}
        metals={metals.data}
        step={view.step}
        onStep={(step) =>
          navigate(
            view.kind === 'create'
              ? { kind: 'create', step }
              : { kind: 'edit', productId: view.productId, step },
          )
        }
        onDone={(saved) => {
          setNotice(
            view.kind === 'create'
              ? `已建立「${saved.name}」，新增入庫時可以直接套用。`
              : `已更新「${saved.name}」。`,
          );
          navigate({ kind: 'list' }, 'replace');
        }}
        onCancel={() => navigate({ kind: 'list' }, 'replace')}
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

      {/*
        The create form used to live here, permanently expanded: eight fields
        stacked on a phone, so the catalogue began most of a screen down. It is
        a wizard now, and this page opens on the catalogue itself.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            navigate({ kind: 'create', step: FIRST_PRODUCT_STEP });
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800 dark:hover:bg-teal-600"
        >
          新增商品規格
        </button>
        {notice && (
          <span
            role="status"
            className="text-sm font-medium text-emerald-700 dark:text-emerald-300"
          >
            {notice}
          </span>
        )}
      </div>

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
            尚未建立商品規格。建立之後，就能在入庫 Wizard 中直接選用。
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
                  onEdit={(id) => {
                    setNotice(null);
                    navigate({ kind: 'edit', productId: id, step: FIRST_PRODUCT_STEP });
                  }}
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
  onEdit,
}: {
  products: readonly ProductDefinition[];
  onEdit: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-3 md:hidden">
        {products.map((product) => (
          <MobileProductCard key={product.id} product={product} onEdit={() => onEdit(product.id)} />
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
                  {/* The weight must be the part that wraps: the 編輯 button
                      cannot shrink, so without min-w-0 the pair ran 3px past
                      the cell in a narrow Mac window. */}
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      {formatProductWeight(product)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEdit(product.id)}
                      className="shrink-0 min-h-[44px] min-w-[44px] rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-teal-50 dark:hover:bg-teal-950"
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
