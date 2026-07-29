import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import argon2 from 'argon2';

import {
  BACKUP_VERSION,
  BackupFormatError,
  HEADER_BYTES,
  IV_BYTES,
  KDF_ARGON2ID,
  SALT_BYTES,
  TAG_BYTES,
  decodeHeader,
  encodeHeader,
  type BackupHeader,
} from './backup-format.js';

/**
 * Passphrase-based encryption for backup files (PRD §24.2 備份檔加密).
 *
 * The key comes from a user-supplied passphrase rather than the deployment's
 * `ENCRYPTION_KEY`, because a backup's whole purpose is surviving the machine
 * that produced it. A key living only in that machine's environment would make
 * every backup useless in exactly the disaster it exists for.
 */

/** Deliberately costly: a backup file may be copied somewhere less private. */
const KDF_MEMORY_KIB = 65_536;
const KDF_TIME_COST = 3;
const KDF_PARALLELISM = 1;
const KEY_BYTES = 32;

export const MIN_PASSPHRASE_LENGTH = 12;

export async function deriveKey(passphrase: string, header: BackupHeader): Promise<Buffer> {
  return argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt: header.salt,
    memoryCost: header.memoryKiB,
    timeCost: header.timeCost,
    parallelism: header.parallelism,
    hashLength: KEY_BYTES,
    raw: true,
  });
}

/** Compresses, encrypts, and frames a complete backup file. */
export async function sealBackup(payload: Buffer, passphrase: string): Promise<Buffer> {
  assertPassphrase(passphrase);

  const header: BackupHeader = {
    version: BACKUP_VERSION,
    kdf: KDF_ARGON2ID,
    memoryKiB: KDF_MEMORY_KIB,
    timeCost: KDF_TIME_COST,
    parallelism: KDF_PARALLELISM,
    salt: randomBytes(SALT_BYTES),
    iv: randomBytes(IV_BYTES),
  };

  const key = await deriveKey(passphrase, header);
  const headerBytes = encodeHeader(header);
  const cipher = createCipheriv('aes-256-gcm', key, header.iv);
  // The header is authenticated too, so its KDF parameters cannot be edited
  // to weaken a re-derivation without invalidating the tag.
  cipher.setAAD(headerBytes);

  const ciphertext = Buffer.concat([cipher.update(gzipSync(payload)), cipher.final()]);
  return Buffer.concat([headerBytes, ciphertext, cipher.getAuthTag()]);
}

/**
 * Verifies and decrypts a backup file.
 *
 * The GCM tag is checked before the plaintext is returned, so a truncated or
 * tampered archive can never reach the restore path.
 */
export async function openBackup(file: Buffer, passphrase: string): Promise<Buffer> {
  if (file.length < HEADER_BYTES + TAG_BYTES) {
    throw new BackupFormatError('backup file is truncated');
  }
  const header = decodeHeader(file);
  const headerBytes = file.subarray(0, HEADER_BYTES);
  const tag = file.subarray(file.length - TAG_BYTES);
  const ciphertext = file.subarray(HEADER_BYTES, file.length - TAG_BYTES);

  const key = await deriveKey(passphrase, header);
  const decipher = createDecipheriv('aes-256-gcm', key, header.iv);
  decipher.setAAD(headerBytes);
  decipher.setAuthTag(tag);

  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // A failed tag is indistinguishable from a wrong passphrase, and saying so
    // avoids telling an attacker which of the two they got right.
    throw new BackupFormatError('could not decrypt the backup: wrong passphrase or corrupted file');
  }

  try {
    return gunzipSync(plaintext);
  } catch {
    throw new BackupFormatError('backup payload could not be decompressed');
  }
}

export function assertPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new BackupFormatError(
      `backup passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`,
    );
  }
}

/** Constant-time comparison for digests carried inside the archive. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
