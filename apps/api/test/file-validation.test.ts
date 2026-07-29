import { describe, expect, it } from 'vitest';

import {
  assertSafePixelCount,
  declaredMimeMatches,
  detectAcceptedMedia,
  sha256Hex,
} from '../src/attachments/file-validation.js';

describe('attachment file validation', () => {
  it('detects PNG by signature and reads dimensions', () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.set(new TextEncoder().encode('IHDR'), 12);
    bytes.set([0, 0, 0, 2], 16);
    bytes.set([0, 0, 0, 3], 20);
    expect(detectAcceptedMedia(bytes)).toEqual({
      kind: 'PNG',
      mime: 'image/png',
      width: 2,
      height: 3,
    });
  });

  it('rejects executable content renamed as an image', () => {
    expect(detectAcceptedMedia(new TextEncoder().encode('<svg><script/></svg>'))).toBeNull();
  });

  it('requires the declared MIME to agree with the signature', () => {
    expect(declaredMimeMatches('JPEG', 'image/jpeg')).toBe(true);
    expect(declaredMimeMatches('JPEG', 'application/pdf')).toBe(false);
  });

  it('enforces the decoded pixel limit when dimensions are known', () => {
    expect(() =>
      assertSafePixelCount({ kind: 'PNG', mime: 'image/png', width: 10_000, height: 10_000 }, 60e6),
    ).toThrow(/dimensions/);
  });

  it('returns a stable SHA-256 digest', () => {
    expect(sha256Hex(new TextEncoder().encode('bullion'))).toBe(
      '19203671671155a654f86fc7742ad56a42cb16dd507cd192b0338551b542c331',
    );
  });
});
