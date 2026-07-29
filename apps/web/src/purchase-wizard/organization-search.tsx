import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { CustomSelect } from '../CustomSelect.js';
import { createStableId } from './model.js';
import type {
  OrganizationRole,
  OrganizationSearchProvider,
  WizardOrganization,
  WizardOrganizationAssignment,
} from './types.js';

const EMPTY_ORGANIZATIONS: readonly WizardOrganization[] = [];

export const ORGANIZATION_ROLE_LABELS: Record<OrganizationRole, string> = {
  BRAND: '品牌',
  ISSUER: '發行方',
  REFINER: '精煉廠',
  MINT: '鑄幣廠',
  MANUFACTURER: '製造廠',
  ASSAYER: '檢驗／保證方',
};

export const ORGANIZATION_ROLES = Object.keys(ORGANIZATION_ROLE_LABELS) as OrganizationRole[];
export const NON_BRAND_ORGANIZATION_ROLES = ORGANIZATION_ROLES.filter(
  (role): role is Exclude<OrganizationRole, 'BRAND'> => role !== 'BRAND',
);

export function normalizeOrganizationSearch(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterOrganizations(
  organizations: readonly WizardOrganization[],
  query: string,
  role?: OrganizationRole,
  limit = 20,
): WizardOrganization[] {
  const normalized = normalizeOrganizationSearch(query);
  const capabilityRole =
    role && ['REFINER', 'MINT', 'MANUFACTURER', 'ASSAYER'].includes(role) ? role : undefined;
  const candidates = organizations.filter(
    (organization) =>
      !capabilityRole ||
      !organization.capabilities?.length ||
      organization.capabilities.includes(capabilityRole),
  );
  if (!normalized) return candidates.slice(0, limit);
  return candidates
    .filter((organization) =>
      [organization.canonicalName, ...(organization.aliases ?? [])].some((candidate) =>
        normalizeOrganizationSearch(candidate).includes(normalized),
      ),
    )
    .sort((left, right) => {
      const leftName = normalizeOrganizationSearch(left.canonicalName);
      const rightName = normalizeOrganizationSearch(right.canonicalName);
      const leftRank = leftName === normalized ? 0 : leftName.startsWith(normalized) ? 1 : 2;
      const rightRank = rightName === normalized ? 0 : rightName.startsWith(normalized) ? 1 : 2;
      return leftRank - rightRank || left.canonicalName.localeCompare(right.canonicalName);
    })
    .slice(0, limit);
}

export function replacePrimaryBrandAssignment(
  assignments: readonly WizardOrganizationAssignment[],
  brand: Pick<WizardOrganizationAssignment, 'organizationId' | 'displayName' | 'custom'> | null,
): WizardOrganizationAssignment[] {
  const nonBrands = assignments.filter(({ role }) => role !== 'BRAND');
  if (!brand) return nonBrands;

  const existing = assignments.find(
    (assignment) =>
      assignment.role === 'BRAND' &&
      ((brand.organizationId && assignment.organizationId === brand.organizationId) ||
        normalizeOrganizationSearch(assignment.displayName) ===
          normalizeOrganizationSearch(brand.displayName)),
  );
  return [
    {
      id: existing?.id ?? createStableId('party'),
      ...brand,
      role: 'BRAND',
      isPrimary: true,
    },
    ...nonBrands,
  ];
}

interface OrganizationComboboxProps {
  role: OrganizationRole;
  localOptions?: readonly WizardOrganization[];
  searchProvider?: OrganizationSearchProvider;
  onSelect: (organization: WizardOrganization) => void;
  onCustom?: (displayName: string) => void;
  allowCustom?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function OrganizationCombobox({
  role,
  localOptions,
  searchProvider,
  onSelect,
  onCustom,
  allowCustom = true,
  label,
  placeholder = '例如 PAMP、UBS、Argor-Heraeus',
  disabled = false,
}: OrganizationComboboxProps) {
  const id = useId();
  const listboxId = `${id}-organizations`;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WizardOrganization[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestSequence = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = localOptions ?? EMPTY_ORGANIZATIONS;

  useEffect(() => {
    if (!open || disabled) {
      setLoading(false);
      return;
    }
    const trimmed = query.trim();
    if (!searchProvider) {
      setResults(filterOrganizations(options, trimmed, role));
      setLoading(false);
      setActiveIndex(0);
      return;
    }
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setLoading(true);
    const timer = globalThis.setTimeout(
      () => {
        void searchProvider(trimmed, { role, limit: 20, signal: controller.signal })
          .then((nextResults) => {
            if (sequence !== requestSequence.current || controller.signal.aborted) return;
            setResults(nextResults.slice(0, 20));
            setActiveIndex(0);
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            if (sequence === requestSequence.current) {
              setResults([]);
              setOpen(true);
            }
            if (error instanceof Error && error.name === 'AbortError') return;
          })
          .finally(() => {
            if (sequence === requestSequence.current) setLoading(false);
          });
      },
      trimmed ? 220 : 0,
    );
    return () => {
      controller.abort();
      globalThis.clearTimeout(timer);
    };
  }, [disabled, open, options, query, role, searchProvider]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  const exactMatch = useMemo(() => {
    const normalized = normalizeOrganizationSearch(query);
    return results.some(
      ({ canonicalName, aliases }) =>
        normalizeOrganizationSearch(canonicalName) === normalized ||
        aliases?.some((alias) => normalizeOrganizationSearch(alias) === normalized),
    );
  }, [query, results]);

  function select(organization: WizardOrganization) {
    onSelect(organization);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label className="block space-y-1.5 text-sm" htmlFor={`${id}-input`}>
        <span className="font-medium">{label ?? `搜尋${ORGANIZATION_ROLE_LABELS[role]}`}</span>
        <input
          id={`${id}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={
            open && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined
          }
          className="w-full rounded-lg border px-3 py-2"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            const nextFocus = event.relatedTarget;
            if (!(nextFocus instanceof Node) || !rootRef.current?.contains(nextFocus)) {
              setOpen(false);
            }
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Tab') {
              setOpen(false);
              return;
            }
            if (!open && event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((value) => Math.max(value - 1, 0));
            } else if (event.key === 'Enter' && results[activeIndex]) {
              event.preventDefault();
              select(results[activeIndex]!);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </label>
      <p className="sr-only" aria-live="polite">
        {loading ? '正在搜尋' : open ? `${results.length} 個搜尋結果` : ''}
      </p>
      {open && (
        <div className="surface absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg p-1 shadow-lg">
          <ul
            id={listboxId}
            role="listbox"
            aria-label={`${ORGANIZATION_ROLE_LABELS[role]}搜尋結果`}
          >
            {results.map((organization, index) => (
              <li
                id={`${id}-option-${index}`}
                key={organization.id}
                role="option"
                aria-selected={activeIndex === index}
                className={`w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm ${
                  activeIndex === index ? 'bg-teal-50 dark:bg-teal-950' : 'interactive-muted'
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(organization)}
              >
                <span className="block font-medium">{organization.canonicalName}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {[organization.countryCode, organization.matchedAlias]
                    .filter(Boolean)
                    .join(' · ') || ORGANIZATION_ROLE_LABELS[role]}
                </span>
              </li>
            ))}
          </ul>
          {!loading && allowCustom && onCustom && query.trim() && !exactMatch && (
            <button
              type="button"
              className="interactive-muted mt-1 w-full rounded-md px-3 py-2 text-left text-sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onCustom(query.trim());
                setQuery('');
                setOpen(false);
              }}
            >
              使用自訂{ORGANIZATION_ROLE_LABELS[role]}「{query.trim()}」
            </button>
          )}
          {!loading && results.length === 0 && !query.trim() && (
            <p className="px-3 py-2 text-sm text-slate-500">目前沒有可用的組織。</p>
          )}
        </div>
      )}
    </div>
  );
}

interface BrandOrganizationSelectorProps {
  assignments: readonly WizardOrganizationAssignment[];
  localOptions?: readonly WizardOrganization[];
  searchProvider?: OrganizationSearchProvider;
  onChange: (assignments: WizardOrganizationAssignment[]) => void;
}

export function BrandOrganizationSelector({
  assignments,
  localOptions,
  searchProvider,
  onChange,
}: BrandOrganizationSelectorProps) {
  const brands = assignments.filter(({ role }) => role === 'BRAND');
  const selected = brands.find(({ isPrimary }) => isPrimary) ?? brands[0];

  return (
    <div className="col-span-full space-y-2">
      <OrganizationCombobox
        role="BRAND"
        label={selected ? '更換品牌／鑄幣廠' : '品牌／鑄幣廠（選填）'}
        placeholder="搜尋 PAMP、UBS 或其他品牌"
        localOptions={localOptions}
        searchProvider={searchProvider}
        onSelect={(organization) =>
          onChange(
            replacePrimaryBrandAssignment(assignments, {
              organizationId: organization.id,
              displayName: organization.canonicalName,
              custom: false,
            }),
          )
        }
        onCustom={(displayName) =>
          onChange(
            replacePrimaryBrandAssignment(assignments, {
              displayName,
              custom: true,
            }),
          )
        }
      />
      {selected ? (
        <div className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border border-teal-300 bg-teal-50 pl-3 text-sm dark:border-teal-800 dark:bg-teal-950">
          <span className="min-w-0 break-words font-medium">
            已選：{selected.displayName}
            {selected.custom ? '（自訂）' : ''}
          </span>
          <button
            type="button"
            className="min-h-11 min-w-11 shrink-0 rounded-lg text-danger"
            aria-label={`清除品牌 ${selected.displayName}`}
            onClick={() => onChange(replacePrimaryBrandAssignment(assignments, null))}
          >
            ×
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          可搜尋正式名稱、縮寫與常見別名；找不到時仍可保留自訂品牌。
        </p>
      )}
      {brands.length > 1 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          此草稿原有 {brands.length} 個品牌；選擇新品牌時會整理為單一主要品牌。
        </p>
      ) : null}
    </div>
  );
}

interface OrganizationAssignmentsEditorProps {
  assignments: readonly WizardOrganizationAssignment[];
  localOptions?: readonly WizardOrganization[];
  searchProvider?: OrganizationSearchProvider;
  roles?: readonly OrganizationRole[];
  roleLabel?: string;
  emptyMessage?: string;
  onChange: (assignments: WizardOrganizationAssignment[]) => void;
}

export function OrganizationAssignmentsEditor({
  assignments,
  localOptions,
  searchProvider,
  roles = ORGANIZATION_ROLES,
  roleLabel = '組織角色',
  emptyMessage = '尚未指定品牌、發行方或實際製造來源；不知道時可稍後補齊。',
  onChange,
}: OrganizationAssignmentsEditorProps) {
  const [role, setRole] = useState<OrganizationRole>(roles[0] ?? 'BRAND');
  const visibleAssignments = assignments.filter((assignment) => roles.includes(assignment.role));

  useEffect(() => {
    if (!roles.includes(role) && roles[0]) setRole(roles[0]);
  }, [role, roles]);

  function add(assignment: Omit<WizardOrganizationAssignment, 'id'>) {
    if (
      assignments.some(
        (current) =>
          current.role === assignment.role &&
          ((current.organizationId && current.organizationId === assignment.organizationId) ||
            normalizeOrganizationSearch(current.displayName) ===
              normalizeOrganizationSearch(assignment.displayName)),
      )
    ) {
      return;
    }
    const withPrimary =
      assignment.role === 'BRAND' && !assignments.some(({ role }) => role === 'BRAND');
    onChange([
      ...assignments,
      {
        ...assignment,
        id: createStableId('party'),
        isPrimary: assignment.isPrimary || withPrimary,
      },
    ]);
  }

  return (
    <div className="col-span-full space-y-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(8rem,0.45fr)_minmax(0,1fr)]">
        <CustomSelect
          label={roleLabel}
          value={role}
          onChange={(nextRole) => setRole(nextRole as OrganizationRole)}
          options={roles.map((option) => ({
            value: option,
            label: ORGANIZATION_ROLE_LABELS[option],
          }))}
        />
        <OrganizationCombobox
          role={role}
          localOptions={localOptions}
          searchProvider={searchProvider}
          onSelect={(organization) =>
            add({
              organizationId: organization.id,
              displayName: organization.canonicalName,
              role,
              isPrimary: false,
              custom: false,
            })
          }
          onCustom={(displayName) => add({ displayName, role, isPrimary: false, custom: true })}
        />
      </div>
      {visibleAssignments.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="已選擇的組織">
          {visibleAssignments.map((assignment) => (
            <li
              key={assignment.id}
              className="flex min-w-0 items-center gap-1 rounded-2xl border border-slate-300 bg-white pl-3 text-sm dark:border-slate-600 dark:bg-slate-950"
            >
              <span className="min-w-0 break-words">
                {ORGANIZATION_ROLE_LABELS[assignment.role]}：{assignment.displayName}
                {assignment.custom ? '（自訂）' : ''}
              </span>
              {assignment.role === 'BRAND' && (
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded px-2 text-xs text-accent dark:text-teal-400"
                  aria-pressed={assignment.isPrimary}
                  onClick={() =>
                    onChange(
                      assignments.map((candidate) => ({
                        ...candidate,
                        isPrimary:
                          candidate.role === 'BRAND'
                            ? candidate.id === assignment.id
                            : candidate.isPrimary,
                      })),
                    )
                  }
                >
                  {assignment.isPrimary ? '主要品牌' : '設為主要'}
                </button>
              )}
              <button
                type="button"
                className="min-h-11 min-w-11 shrink-0 rounded-xl text-danger"
                aria-label={`移除${assignment.displayName}`}
                onClick={() => onChange(assignments.filter(({ id }) => id !== assignment.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
