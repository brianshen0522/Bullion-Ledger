import { createHash } from 'node:crypto';

export type AcceptedMediaKind = 'JPEG' | 'PNG' | 'WEBP' | 'HEIC' | 'PDF';

export interface DetectedMedia {
  kind: AcceptedMediaKind;
  mime: string;
  width: number | null;
  height: number | null;
}

const MIME_BY_KIND: Record<AcceptedMediaKind, readonly string[]> = {
  JPEG: ['image/jpeg', 'image/jpg'],
  PNG: ['image/png'],
  WEBP: ['image/webp'],
  HEIC: ['image/heic', 'image/heif'],
  PDF: ['application/pdf'],
};

/**
 * Detects the small allow-list accepted by the attachment API from file
 * signatures. Extensions and browser-provided Content-Type values are never
 * authoritative.
 */
export function detectAcceptedMedia(bytes: Uint8Array): DetectedMedia | null {
  if (isJpeg(bytes)) {
    const dimensions = jpegDimensions(bytes);
    return { kind: 'JPEG', mime: 'image/jpeg', ...dimensions };
  }
  if (isPng(bytes)) {
    return {
      kind: 'PNG',
      mime: 'image/png',
      width: readUint32Be(bytes, 16),
      height: readUint32Be(bytes, 20),
    };
  }
  if (isWebp(bytes)) {
    const dimensions = webpDimensions(bytes);
    return { kind: 'WEBP', mime: 'image/webp', ...dimensions };
  }
  if (isHeifFamily(bytes)) {
    const majorBrand = ascii(bytes, 8, 12);
    const dimensions = heifDimensions(bytes);
    return {
      kind: 'HEIC',
      mime: majorBrand.startsWith('hei') ? 'image/heic' : 'image/heif',
      ...dimensions,
    };
  }
  if (ascii(bytes, 0, 5) === '%PDF-') {
    return { kind: 'PDF', mime: 'application/pdf', width: null, height: null };
  }
  return null;
}

export function declaredMimeMatches(kind: AcceptedMediaKind, declaredMime: string): boolean {
  const normalized = declaredMime.split(';', 1)[0]!.trim().toLowerCase();
  return MIME_BY_KIND[kind].includes(normalized);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertSafePixelCount(
  media: DetectedMedia,
  maxPixels: number,
): { width: number | null; height: number | null } {
  if (media.width === null || media.height === null) {
    return { width: media.width, height: media.height };
  }
  if (media.width <= 0 || media.height <= 0 || media.width * media.height > maxPixels) {
    throw new Error('Image dimensions exceed the configured safety limit');
  }
  return { width: media.width, height: media.height };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return (
    bytes.length >= 24 &&
    signature.every((value, index) => bytes[index] === value) &&
    ascii(bytes, 12, 16) === 'IHDR'
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
}

function isHeifFamily(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return false;
  const brand = ascii(bytes, 8, 12);
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
}

function jpegDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const segmentLength = readUint16Be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (isStartOfFrame(marker) && segmentLength >= 7) {
      return {
        height: readUint16Be(bytes, offset + 3),
        width: readUint16Be(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return { width: null, height: null };
}

function isStartOfFrame(marker: number): boolean {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
    marker,
  );
}

function webpDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  const chunk = ascii(bytes, 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + readUint24Le(bytes, 24),
      height: 1 + readUint24Le(bytes, 27),
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    // Lossy VP8 stores the 14-bit dimensions immediately after the frame
    // sync code 9d 01 2a.
    for (let offset = 20; offset + 7 < Math.min(bytes.length, 40); offset += 1) {
      if (bytes[offset] === 0x9d && bytes[offset + 1] === 0x01 && bytes[offset + 2] === 0x2a) {
        return {
          width: readUint16Le(bytes, offset + 3) & 0x3fff,
          height: readUint16Le(bytes, offset + 5) & 0x3fff,
        };
      }
    }
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits =
      (bytes[21] ?? 0) |
      ((bytes[22] ?? 0) << 8) |
      ((bytes[23] ?? 0) << 16) |
      ((bytes[24] ?? 0) << 24);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff),
    };
  }
  return { width: null, height: null };
}

function heifDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  // HEIF/HEIC stores the display dimensions in an `ispe` property box. A
  // complete ISO-BMFF parser is intentionally out of scope here; this bounded
  // scan is enough to enforce a pixel ceiling before the worker performs a
  // full decode.
  for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
    if (ascii(bytes, offset, offset + 4) !== 'ispe') continue;
    const width = readUint32Be(bytes, offset + 8);
    const height = readUint32Be(bytes, offset + 12);
    if (width > 0 && height > 0) return { width, height };
  }
  return { width: null, height: null };
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));
}

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}
