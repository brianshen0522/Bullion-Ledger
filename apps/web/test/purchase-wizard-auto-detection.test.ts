import { describe, expect, it } from 'vitest';

import {
  detectDocumentCorners,
  detectObjectCrop,
  type PixelBuffer,
} from '../src/purchase-wizard/auto-detection.js';

function image(width: number, height: number, background = [242, 242, 242]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = background[0]!;
    data[index * 4 + 1] = background[1]!;
    data[index * 4 + 2] = background[2]!;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

function fillRect(
  buffer: PixelBuffer,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: [number, number, number],
) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offset = (y * buffer.width + x) * 4;
      (buffer.data as Uint8ClampedArray)[offset] = color[0];
      (buffer.data as Uint8ClampedArray)[offset + 1] = color[1];
      (buffer.data as Uint8ClampedArray)[offset + 2] = color[2];
    }
  }
}

describe('local media auto detection', () => {
  it('finds and pads a coherent bullion subject without replacing the original', () => {
    const buffer = image(100, 80);
    fillRect(buffer, 25, 14, 74, 65, [191, 142, 30]);

    const result = detectObjectCrop(buffer);

    expect(result).not.toBeNull();
    expect(result!.value.x).toBeCloseTo(0.22, 1);
    expect(result!.value.y).toBeCloseTo(0.11, 1);
    expect(result!.value.width).toBeGreaterThan(0.5);
    expect(result!.value.height).toBeGreaterThan(0.65);
    expect(result!.confidence).toBeGreaterThan(0.5);
  });

  it('estimates the four corners of a contrasting document', () => {
    const buffer = image(120, 100, [35, 35, 35]);
    // A slightly skewed document: top edge narrows toward the right.
    for (let y = 15; y <= 85; y += 1) {
      const progress = (y - 15) / 70;
      const left = Math.round(24 - progress * 7);
      const right = Math.round(91 + progress * 8);
      fillRect(buffer, left, y, right, y, [246, 245, 238]);
    }

    const result = detectDocumentCorners(buffer);

    expect(result).not.toBeNull();
    expect(result!.value.topLeft.x).toBeGreaterThan(0.15);
    expect(result!.value.topLeft.y).toBeLessThan(0.25);
    expect(result!.value.bottomRight.x).toBeGreaterThan(0.75);
    expect(result!.value.bottomRight.y).toBeGreaterThan(0.75);
  });

  it('returns null for a flat image instead of pretending detection succeeded', () => {
    expect(detectObjectCrop(image(64, 64))).toBeNull();
    expect(detectDocumentCorners(image(64, 64))).toBeNull();
  });
});
