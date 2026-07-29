import { describe, expect, it } from 'vitest';

import { base64UrlToBytes, bytesToBase64Url, isPasskeySupported } from '../src/webauthn.js';

describe('base64url transcoding', () => {
  it('round-trips arbitrary bytes, including values that need URL-safe symbols', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;

    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
  });

  it('decodes unpadded input at every remainder length', () => {
    for (const source of [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5]]) {
      const bytes = new Uint8Array(source);
      expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes)))).toEqual(source);
    }
  });

  it('handles an empty value', () => {
    expect(bytesToBase64Url(new Uint8Array())).toBe('');
    expect(base64UrlToBytes('')).toHaveLength(0);
  });

  it('survives a payload larger than one encoding chunk', () => {
    // Attestation objects routinely exceed the 0x8000 chunk boundary.
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, index) => index % 251);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toHaveLength(bytes.length);
  });

  it('accepts a plain ArrayBuffer as well as a view', () => {
    const bytes = new Uint8Array([9, 8, 7]);
    expect(bytesToBase64Url(bytes.buffer)).toBe(bytesToBase64Url(bytes));
  });
});

describe('capability detection', () => {
  it('reports no support when the runtime lacks PublicKeyCredential', () => {
    // The Node test environment has no WebAuthn, which is the branch the login
    // screen relies on to avoid advertising a button that cannot work.
    expect(isPasskeySupported()).toBe(false);
  });
});
