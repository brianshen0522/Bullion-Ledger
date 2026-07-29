import { api, type OrganizationListItem } from './api.js';
import type { OrganizationSearchProvider } from './purchase-wizard/types.js';

/** Searches the shared organization catalog and adapts its API shape for form comboboxes. */
export const searchOrganizationCatalog: OrganizationSearchProvider = async (query, options) => {
  const parameters = new URLSearchParams({ q: query, limit: String(options.limit) });
  if (options.role) parameters.set('capabilities', options.role);

  const organizations = await api.get<OrganizationListItem[]>(
    `/organizations?${parameters.toString()}`,
  );
  if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');

  return organizations.map((organization) => ({
    id: organization.id,
    canonicalName: organization.canonicalName,
    countryCode: organization.countryCode ?? undefined,
    aliases: organization.aliases.map(({ name }) => name),
    capabilities: organization.capabilities,
    matchedAlias: organization.matchedAlias ?? undefined,
  }));
};
