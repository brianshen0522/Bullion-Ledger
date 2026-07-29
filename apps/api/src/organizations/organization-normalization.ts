/**
 * Produces the stable search/deduplication key stored in Organization and
 * OrganizationAlias. NFKC handles full-width forms commonly entered on mobile
 * keyboards while preserving letters and numbers from every writing system.
 */
export function normalizeOrganizationName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
