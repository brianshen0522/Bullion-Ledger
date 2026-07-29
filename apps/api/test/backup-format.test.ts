import { describe, expect, it } from 'vitest';

import {
  BACKUP_VERSION,
  BackupFormatError,
  HEADER_BYTES,
  KDF_ARGON2ID,
  decodeEntries,
  decodeHeader,
  encodeEntry,
  encodeHeader,
  isSafeObjectKey,
} from '../src/backup/backup-format';
import { openBackup, sealBackup } from '../src/backup/backup-crypto';
import { reviveDates } from '../src/backup/backup.service';

const PASSPHRASE = 'a-sufficiently-long-passphrase';

function header() {
  return {
    version: BACKUP_VERSION,
    kdf: KDF_ARGON2ID,
    memoryKiB: 65_536,
    timeCost: 3,
    parallelism: 1,
    salt: Buffer.alloc(16, 7),
    iv: Buffer.alloc(12, 9),
  };
}

describe('backup header', () => {
  it('round-trips every field', () => {
    const decoded = decodeHeader(encodeHeader(header()));
    expect(decoded.memoryKiB).toBe(65_536);
    expect(decoded.timeCost).toBe(3);
    expect(decoded.salt.equals(Buffer.alloc(16, 7))).toBe(true);
    expect(decoded.iv.equals(Buffer.alloc(12, 9))).toBe(true);
  });

  it('rejects a file that is not a backup', () => {
    expect(() => decodeHeader(Buffer.alloc(HEADER_BYTES, 0))).toThrow(BackupFormatError);
  });

  it('rejects a truncated file', () => {
    expect(() => decodeHeader(Buffer.alloc(4))).toThrow(/too short/);
  });

  it('refuses KDF parameters that would exhaust memory', () => {
    // A hostile header must not be able to ask for gigabytes during derivation.
    const hostile = encodeHeader({ ...header(), memoryKiB: 900_000_000 });
    expect(() => decodeHeader(hostile)).toThrow(/unreasonable/);
  });

  it('refuses a future format version instead of guessing', () => {
    const future = encodeHeader({ ...header(), version: BACKUP_VERSION + 1 });
    expect(() => decodeHeader(future)).toThrow(/not supported/);
  });
});

describe('entry framing', () => {
  it('round-trips names and binary content', () => {
    const payload = Buffer.concat([
      encodeEntry('manifest.json', Buffer.from('{"a":1}', 'utf8')),
      encodeEntry('objects/a/b.jpg', Buffer.from([0, 255, 128])),
    ]);
    const entries = decodeEntries(payload, 1_000_000);

    expect(entries.map((entry) => entry.name)).toEqual(['manifest.json', 'objects/a/b.jpg']);
    expect(entries[1]?.content.equals(Buffer.from([0, 255, 128]))).toBe(true);
  });

  it('handles empty content', () => {
    const entries = decodeEntries(encodeEntry('empty', Buffer.alloc(0)), 1000);
    expect(entries[0]?.content.length).toBe(0);
  });

  it('refuses an entry claiming more bytes than the payload holds', () => {
    const payload = encodeEntry('a', Buffer.from('hello'));
    payload.writeBigUInt64BE(9_000n, 2);
    expect(() => decodeEntries(payload, 1_000_000)).toThrow(/past the end/);
  });

  it('refuses a payload that exceeds the restore ceiling', () => {
    const payload = encodeEntry('a', Buffer.alloc(500));
    expect(() => decodeEntries(payload, 100)).toThrow(/implausible size|maximum restorable/);
  });

  it('refuses a truncated frame header', () => {
    expect(() => decodeEntries(Buffer.alloc(5), 1000)).toThrow(/mid-entry/);
  });
});

describe('object key safety', () => {
  it('accepts the shapes the application produces', () => {
    expect(isSafeObjectKey('intake/abc/original-1.jpg')).toBe(true);
    expect(isSafeObjectKey('a_b-c.9/x.pdf')).toBe(true);
  });

  it('rejects traversal and absolute paths', () => {
    // A crafted archive must not be able to write outside the bucket layout.
    expect(isSafeObjectKey('../../etc/passwd')).toBe(false);
    expect(isSafeObjectKey('/etc/passwd')).toBe(false);
    expect(isSafeObjectKey('a/../../b')).toBe(false);
  });

  it('rejects backslashes, nulls, and empty keys', () => {
    expect(isSafeObjectKey('a\\b')).toBe(false);
    expect(isSafeObjectKey('a\0b')).toBe(false);
    expect(isSafeObjectKey('')).toBe(false);
  });
});

describe('sealed archives', () => {
  it('round-trips a payload through encryption', async () => {
    const payload = Buffer.from('the ledger contents', 'utf8');
    const sealed = await sealBackup(payload, PASSPHRASE);

    expect(sealed.subarray(0, 5).toString()).toBe('BLBAK');
    expect(sealed.includes(Buffer.from('the ledger contents'))).toBe(false);
    expect((await openBackup(sealed, PASSPHRASE)).equals(payload)).toBe(true);
  });

  it('refuses the wrong passphrase without saying which part was wrong', async () => {
    const sealed = await sealBackup(Buffer.from('secret'), PASSPHRASE);
    await expect(openBackup(sealed, 'a-different-passphrase')).rejects.toThrow(
      /wrong passphrase or corrupted file/,
    );
  });

  it('detects a tampered ciphertext', async () => {
    const sealed = await sealBackup(Buffer.from('secret contents here'), PASSPHRASE);
    // Flip a byte well inside the ciphertext.
    sealed[HEADER_BYTES + 4] ^= 0xff;
    await expect(openBackup(sealed, PASSPHRASE)).rejects.toThrow(/wrong passphrase or corrupted/);
  });

  it('detects a tampered header, which is authenticated too', async () => {
    const sealed = await sealBackup(Buffer.from('secret'), PASSPHRASE);
    // Weakening the declared time cost must not go unnoticed.
    sealed.writeUInt8(2, 14);
    await expect(openBackup(sealed, PASSPHRASE)).rejects.toThrow();
  });

  it('detects truncation', async () => {
    const sealed = await sealBackup(Buffer.from('secret'), PASSPHRASE);
    await expect(openBackup(sealed.subarray(0, sealed.length - 4), PASSPHRASE)).rejects.toThrow();
  });

  it('produces a different ciphertext each time for the same input', async () => {
    const first = await sealBackup(Buffer.from('same'), PASSPHRASE);
    const second = await sealBackup(Buffer.from('same'), PASSPHRASE);
    // Random salt and IV per archive.
    expect(first.equals(second)).toBe(false);
  });

  it('refuses a passphrase too short to protect a credential archive', async () => {
    await expect(sealBackup(Buffer.from('x'), 'short')).rejects.toThrow(/at least 12/);
  });
});

describe('restoring typed columns from JSON', () => {
  it('revives ISO timestamps into Dates', () => {
    const revived = reviveDates({ createdAt: '2026-07-29T10:00:00.000Z', name: 'not a date' });
    expect(revived.createdAt).toBeInstanceOf(Date);
    expect(revived.name).toBe('not a date');
  });

  it('revives a serialized Buffer, as passkey public keys are stored', () => {
    const revived = reviveDates({ publicKey: { type: 'Buffer', data: [1, 2, 3] } });
    expect(Buffer.isBuffer(revived.publicKey)).toBe(true);
    expect((revived.publicKey as Buffer).equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('leaves ordinary values untouched', () => {
    const revived = reviveDates({ count: 5, flag: true, missing: null, text: '2026' });
    expect(revived).toEqual({ count: 5, flag: true, missing: null, text: '2026' });
  });
});
