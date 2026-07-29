/** Mirrors the server's minimum; a credential archive deserves a real passphrase. */
export const MIN_BACKUP_PASSPHRASE = 12;

export interface BackupManifestSummary {
  formatVersion: number;
  createdAt: string;
  application: string;
  counts: Record<string, number>;
  objects: { key: string; sha256: string; sizeBytes: number }[];
}

/** Table names in the order a person would want to read them. */
const READABLE: [string, string][] = [
  ['appUser', '帳號'],
  ['userPasskey', '密碼金鑰'],
  ['productDefinition', '商品規格'],
  ['purchase', '購買交易'],
  ['asset', '持有資產'],
  ['assetMovement', '異動紀錄'],
  ['attachment', '照片與文件'],
  ['spotPriceSnapshot', '行情紀錄'],
];

/**
 * Turns a manifest into the impact statement PRD §24.3 requires before a
 * restore. Only non-empty groups are listed, so the summary reads as what the
 * archive actually holds rather than a table census.
 */
export function describeManifest(manifest: BackupManifestSummary): string[] {
  const lines: string[] = [];
  const created = new Date(manifest.createdAt);
  if (!Number.isNaN(created.getTime())) {
    lines.push(`備份時間：${created.toLocaleString()}`);
  }

  for (const [key, label] of READABLE) {
    const count = manifest.counts[key] ?? 0;
    if (count > 0) lines.push(`${label}：${count} 筆`);
  }

  const bytes = manifest.objects.reduce((sum, object) => sum + object.sizeBytes, 0);
  if (manifest.objects.length > 0) {
    lines.push(`檔案：${manifest.objects.length} 個（${(bytes / 1024 / 1024).toFixed(2)} MB）`);
  }
  return lines;
}
