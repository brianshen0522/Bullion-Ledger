import { describe, expect, it } from 'vitest';

import { createCropPixelPlan } from '../src/purchase-wizard/media-processing.js';

describe('processed media geometry', () => {
  it('converts a normalized crop to bounded source pixels and caps output size', () => {
    expect(createCropPixelPlan({ x: 0.1, y: 0.2, width: 0.75, height: 0.5 }, 4000, 3000)).toEqual({
      sourceX: 400,
      sourceY: 600,
      sourceWidth: 3000,
      sourceHeight: 1500,
      outputWidth: 2048,
      outputHeight: 1024,
    });
  });

  it('clamps recipes to the source image and rejects an empty result', () => {
    expect(createCropPixelPlan({ x: -1, y: -1, width: 1.5, height: 1.5 }, 100, 80)).toEqual(
      expect.objectContaining({ sourceX: 0, sourceY: 0, sourceWidth: 50, sourceHeight: 40 }),
    );
    expect(() => createCropPixelPlan({ x: 1, y: 1, width: 0, height: 0 }, 100, 80)).toThrow(/無效/);
  });
});
