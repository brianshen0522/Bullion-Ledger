import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.module.js';
import { StorageService } from '../storage/storage.service.js';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import {
  BackupFormatError,
  decodeEntries,
  encodeEntry,
  isSafeObjectKey,
  sha256Hex,
  type BackupEntry,
} from './backup-format.js';
import { openBackup, sealBackup } from './backup-crypto.js';

/** Ceiling on a restorable archive, to bound memory during import. */
const MAX_RESTORE_BYTES = 2 * 1024 * 1024 * 1024;
const MANIFEST_ENTRY = 'manifest.json';
const OBJECT_PREFIX = 'objects/';

/**
 * Tables captured, in dependency order. Restore inserts in this order and
 * deletes in reverse, so foreign keys are always satisfied.
 */
const TABLES = [
  'appUser',
  'userPasskey',
  'metal',
  'organization',
  'organizationAlias',
  'organizationCapability',
  'productDefinition',
  'productOrganization',
  'purchase',
  'purchaseItem',
  'purchaseItemOrganizationSnapshot',
  'purchasePriceSnapshot',
  'asset',
  'assetMovement',
  'attachment',
  'attachmentVariant',
  'spotPriceSnapshot',
  'fxRateSnapshot',
  'priceProviderStatus',
  'systemSetting',
] as const;

type TableName = (typeof TABLES)[number];

export interface BackupManifest {
  formatVersion: number;
  createdAt: string;
  application: string;
  counts: Record<string, number>;
  objects: { key: string; sha256: string; sizeBytes: number }[];
  tables: Record<string, unknown[]>;
}

export interface RestoreSummary {
  restoredTables: Record<string, number>;
  restoredObjects: number;
  skippedObjects: string[];
  createdAt: string;
}

/**
 * Full backup and restore (PRD §24).
 *
 * The archive intentionally includes the account row and passkey credentials:
 * a restore is meant to reproduce the deployment, and an owner locked out of
 * their own restored ledger would not have a working backup. That also makes
 * the file as sensitive as the ledger itself, which is why it is always
 * encrypted with a passphrase the operator chooses.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger('Backup');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** Builds an encrypted archive of the entire deployment. */
  async export(passphrase: string, context: AuditContext = {}): Promise<Buffer> {
    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      const rows = await this.readTable(table);
      tables[table] = rows;
      counts[table] = rows.length;
    }

    // Every stored object referenced by an attachment or one of its variants.
    const keys = await this.objectKeys();
    const objectEntries: Buffer[] = [];
    const objects: BackupManifest['objects'] = [];
    for (const key of keys) {
      try {
        const bytes = await this.storage.getObjectBytes(key);
        objects.push({ key, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength });
        objectEntries.push(encodeEntry(`${OBJECT_PREFIX}${key}`, bytes));
      } catch (error) {
        // A missing blob must not abort the whole backup; the manifest simply
        // will not claim it, and the restore will not expect it.
        this.logger.warn(`Skipping unreadable object ${key}: ${(error as Error).message}`);
      }
    }

    const manifest: BackupManifest = {
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      application: 'bullion-ledger',
      counts,
      objects,
      tables,
    };

    const payload = Buffer.concat([
      encodeEntry(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest), 'utf8')),
      ...objectEntries,
    ]);
    const sealed = await sealBackup(payload, passphrase);

    await this.audit.record({
      ...context,
      action: 'backup.export',
      resourceType: 'Backup',
      afterSummary: {
        counts,
        objects: objects.length,
        bytes: sealed.byteLength,
      },
    });
    return sealed;
  }

  /** Reads an archive without applying it, for the pre-restore impact screen. */
  async inspect(file: Buffer, passphrase: string): Promise<Omit<BackupManifest, 'tables'>> {
    const manifest = await this.parse(file, passphrase);
    const { tables: _tables, ...rest } = manifest.manifest;
    void _tables;
    return rest;
  }

  /**
   * Replaces the deployment's contents with the archive (PRD §24.3).
   *
   * Everything happens in one transaction: a restore that fails halfway would
   * otherwise leave a ledger that is neither the old one nor the new one. Object
   * storage is written after the transaction commits, since it cannot
   * participate in it.
   */
  async restore(
    file: Buffer,
    passphrase: string,
    context: AuditContext = {},
  ): Promise<RestoreSummary> {
    const { manifest, objects } = await this.parse(file, passphrase);

    const restoredTables: Record<string, number> = {};
    await this.prisma.$transaction(
      async (tx) => {
        // Reverse order clears children before parents.
        for (const table of [...TABLES].reverse()) {
          await delegateFor(tx, table).deleteMany({});
        }
        // Sessions belong to the replaced account and must not survive it.
        await tx.userSession.deleteMany({});
        await tx.webAuthnChallenge.deleteMany({});

        for (const table of TABLES) {
          const rows = manifest.tables[table] ?? [];
          if (rows.length === 0) {
            restoredTables[table] = 0;
            continue;
          }
          for (const row of rows) {
            await delegateFor(tx, table).create({
              data: reviveDates(row as Record<string, unknown>),
            });
          }
          restoredTables[table] = rows.length;
        }
      },
      { timeout: 120_000 },
    );

    let restoredObjects = 0;
    const skippedObjects: string[] = [];
    for (const declared of manifest.objects) {
      const entry = objects.get(declared.key);
      if (!entry) {
        skippedObjects.push(declared.key);
        continue;
      }
      // The manifest's digest is checked against the bytes actually carried,
      // so a modified blob cannot be restored under a trusted name.
      if (sha256Hex(entry) !== declared.sha256) {
        skippedObjects.push(declared.key);
        this.logger.warn(`Object ${declared.key} failed its checksum and was not restored`);
        continue;
      }
      await this.storage.putObject({
        storageKey: declared.key,
        mime: 'application/octet-stream',
        body: entry,
      });
      restoredObjects += 1;
    }

    await this.audit.record({
      ...context,
      action: 'backup.restore',
      resourceType: 'Backup',
      afterSummary: {
        backupCreatedAt: manifest.createdAt,
        restoredTables,
        restoredObjects,
        skippedObjects: skippedObjects.length,
      },
    });

    this.logger.warn(
      `Restore complete from backup dated ${manifest.createdAt}; all sessions revoked`,
    );
    return {
      restoredTables,
      restoredObjects,
      skippedObjects,
      createdAt: manifest.createdAt,
    };
  }

  // --- internals ------------------------------------------------------------

  private async parse(
    file: Buffer,
    passphrase: string,
  ): Promise<{ manifest: BackupManifest; objects: Map<string, Buffer> }> {
    let payload: Buffer;
    try {
      payload = await openBackup(file, passphrase);
    } catch (error) {
      if (error instanceof BackupFormatError) throw new BadRequestException(error.message);
      throw error;
    }

    let entries: BackupEntry[];
    try {
      entries = decodeEntries(payload, MAX_RESTORE_BYTES);
    } catch (error) {
      if (error instanceof BackupFormatError) throw new BadRequestException(error.message);
      throw error;
    }

    const manifestEntry = entries.find((entry) => entry.name === MANIFEST_ENTRY);
    if (!manifestEntry) throw new BadRequestException('backup is missing its manifest');

    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(manifestEntry.content.toString('utf8')) as BackupManifest;
    } catch {
      throw new BadRequestException('backup manifest is not valid JSON');
    }
    if (manifest.application !== 'bullion-ledger') {
      throw new BadRequestException('this file is not a Bullion Ledger backup');
    }
    if (manifest.formatVersion !== 1) {
      throw new BadRequestException(`backup manifest v${manifest.formatVersion} is not supported`);
    }

    const objects = new Map<string, Buffer>();
    for (const entry of entries) {
      if (!entry.name.startsWith(OBJECT_PREFIX)) continue;
      const key = entry.name.slice(OBJECT_PREFIX.length);
      // A crafted archive must not be able to write outside the bucket layout.
      if (!isSafeObjectKey(key)) {
        throw new BadRequestException(`backup contains an unsafe object key: ${key.slice(0, 60)}`);
      }
      objects.set(key, entry.content);
    }

    return { manifest, objects };
  }

  private async readTable(table: TableName): Promise<unknown[]> {
    return delegateFor(this.prisma, table).findMany({});
  }

  private async objectKeys(): Promise<string[]> {
    const [attachments, variants] = await Promise.all([
      this.prisma.attachment.findMany({ select: { storageKey: true } }),
      this.prisma.attachmentVariant.findMany({ select: { storageKey: true } }),
    ]);
    const keys = new Set<string>();
    for (const row of [...attachments, ...variants]) {
      if (isSafeObjectKey(row.storageKey)) keys.add(row.storageKey);
    }
    return [...keys];
  }

  /** Revokes every session, used after a restore replaces the account row. */
  async revokeAllSessions(): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    void this.sessions;
  }
}

/**
 * Resolves a table name to its Prisma delegate. The list is a fixed literal
 * union, so an unknown name means the code and the schema have diverged —
 * which must fail loudly rather than silently skip part of a backup.
 */
function delegateFor(client: unknown, table: TableName): PrismaDelegate {
  const delegate = (client as PrismaDelegates)[table];
  if (!delegate) throw new Error(`No Prisma delegate for table "${table}"`);
  return delegate;
}

interface PrismaDelegate {
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
}

type PrismaDelegates = Record<string, PrismaDelegate>;

/** ISO-8601 strings in the archive are Date columns in the schema. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function reviveDates(row: Record<string, unknown>): Record<string, unknown> {
  const revived: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
      revived[key] = new Date(value);
      continue;
    }
    // Prisma `Bytes` round-trips through JSON as base64.
    if (
      value !== null &&
      typeof value === 'object' &&
      (value as { type?: string }).type === 'Buffer' &&
      Array.isArray((value as { data?: unknown }).data)
    ) {
      revived[key] = Buffer.from((value as { data: number[] }).data);
      continue;
    }
    revived[key] = value;
  }
  return revived;
}
