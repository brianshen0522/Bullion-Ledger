import { createHash } from 'node:crypto';

/**
 * Encrypted backup container (PRD §24).
 *
 * A backup holds the password hash, passkey credentials, storage locations and
 * every photograph of the owner's metal. It is therefore never written in the
 * clear: the file is a small plaintext header (needed to derive the key at all)
 * followed by one AES-256-GCM ciphertext, with the authentication tag as a
 * trailer.
 *
 * Layout:
 *   magic      8 bytes   "BLBAK\0\0\0"
 *   version    1 byte
 *   kdf        1 byte    1 = Argon2id
 *   memoryKiB  4 bytes   big-endian
 *   timeCost   1 byte
 *   parallel   1 byte
 *   salt      16 bytes
 *   iv        12 bytes
 *   payload    …         AES-256-GCM(gzip(framed entries))
 *   tag       16 bytes   trailer
 */

export const BACKUP_MAGIC = Buffer.from('BLBAK\0\0\0', 'binary');
export const BACKUP_VERSION = 1;
export const KDF_ARGON2ID = 1;

export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const HEADER_BYTES = BACKUP_MAGIC.length + 1 + 1 + 4 + 1 + 1 + SALT_BYTES + IV_BYTES;

export interface BackupHeader {
  version: number;
  kdf: number;
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
  salt: Buffer;
  iv: Buffer;
}

export function encodeHeader(header: BackupHeader): Buffer {
  const buffer = Buffer.alloc(HEADER_BYTES);
  let offset = BACKUP_MAGIC.copy(buffer, 0);
  buffer.writeUInt8(header.version, offset++);
  buffer.writeUInt8(header.kdf, offset++);
  buffer.writeUInt32BE(header.memoryKiB, offset);
  offset += 4;
  buffer.writeUInt8(header.timeCost, offset++);
  buffer.writeUInt8(header.parallelism, offset++);
  offset += header.salt.copy(buffer, offset);
  header.iv.copy(buffer, offset);
  return buffer;
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

export function decodeHeader(buffer: Buffer): BackupHeader {
  if (buffer.length < HEADER_BYTES) {
    throw new BackupFormatError('file is too short to be a Bullion Ledger backup');
  }
  if (!buffer.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new BackupFormatError('not a Bullion Ledger backup file');
  }

  let offset = BACKUP_MAGIC.length;
  const version = buffer.readUInt8(offset++);
  if (version !== BACKUP_VERSION) {
    throw new BackupFormatError(
      `backup format v${version} is not supported by this version of the app`,
    );
  }
  const kdf = buffer.readUInt8(offset++);
  if (kdf !== KDF_ARGON2ID) {
    throw new BackupFormatError('backup uses an unknown key-derivation function');
  }
  const memoryKiB = buffer.readUInt32BE(offset);
  offset += 4;
  const timeCost = buffer.readUInt8(offset++);
  const parallelism = buffer.readUInt8(offset++);
  const salt = buffer.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = buffer.subarray(offset, offset + IV_BYTES);

  // A hostile header could otherwise ask for gigabytes of memory during KDF.
  if (memoryKiB < 8 * 1024 || memoryKiB > 1024 * 1024) {
    throw new BackupFormatError('backup declares an unreasonable KDF memory cost');
  }
  if (timeCost < 1 || timeCost > 16 || parallelism < 1 || parallelism > 16) {
    throw new BackupFormatError('backup declares unreasonable KDF parameters');
  }

  return { version, kdf, memoryKiB, timeCost, parallelism, salt, iv };
}

/**
 * Length-prefixed entry framing inside the encrypted payload:
 *   nameLength 2 bytes | name | contentLength 8 bytes | content
 *
 * Chosen over a zip/tar library so the archive format has no third-party
 * parser between an attacker-supplied file and the restore path.
 */
export const MAX_ENTRY_NAME_BYTES = 1024;

export function encodeEntry(name: string, content: Uint8Array): Buffer {
  const nameBuffer = Buffer.from(name, 'utf8');
  if (nameBuffer.length > MAX_ENTRY_NAME_BYTES) {
    throw new BackupFormatError(`entry name is too long: ${name.slice(0, 60)}…`);
  }
  const head = Buffer.alloc(2 + 8);
  head.writeUInt16BE(nameBuffer.length, 0);
  head.writeBigUInt64BE(BigInt(content.byteLength), 2);
  return Buffer.concat([head, nameBuffer, Buffer.from(content)]);
}

export interface BackupEntry {
  name: string;
  content: Buffer;
}

/** Parses framed entries, refusing anything that would over-allocate. */
export function decodeEntries(payload: Buffer, maxTotalBytes: number): BackupEntry[] {
  const entries: BackupEntry[] = [];
  let offset = 0;
  let total = 0;

  while (offset < payload.length) {
    if (offset + 10 > payload.length) {
      throw new BackupFormatError('backup payload ended mid-entry');
    }
    const nameLength = payload.readUInt16BE(offset);
    const contentLength = payload.readBigUInt64BE(offset + 2);
    offset += 10;

    if (nameLength === 0 || nameLength > MAX_ENTRY_NAME_BYTES) {
      throw new BackupFormatError('backup entry declares an invalid name length');
    }
    if (contentLength > BigInt(maxTotalBytes)) {
      throw new BackupFormatError('backup entry declares an implausible size');
    }
    const size = Number(contentLength);
    if (offset + nameLength + size > payload.length) {
      throw new BackupFormatError('backup entry extends past the end of the payload');
    }

    const name = payload.subarray(offset, offset + nameLength).toString('utf8');
    offset += nameLength;
    const content = payload.subarray(offset, offset + size);
    offset += size;

    total += size;
    if (total > maxTotalBytes) {
      throw new BackupFormatError('backup payload exceeds the maximum restorable size');
    }
    entries.push({ name, content: Buffer.from(content) });
  }

  return entries;
}

/**
 * Object keys travel inside the archive and are used to write to storage on
 * restore, so they are constrained to the shapes the app itself produces.
 * Without this a crafted backup could write outside the intended prefix.
 */
export function isSafeObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  if (key.startsWith('/') || key.includes('..')) return false;
  if (key.includes('\\') || key.includes('\0')) return false;
  return /^[A-Za-z0-9._\-/]+$/.test(key);
}

export function sha256Hex(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
