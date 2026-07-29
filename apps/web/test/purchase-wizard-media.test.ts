import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CROP_RECT,
  DEFAULT_DOCUMENT_CORNERS,
  buildAttachmentReviewPayload,
  createPerspectivePlan,
  createWizardMedia,
  inferMediaMime,
  moveCropHandle,
  moveDocumentCorner,
  projectPoint,
  replaceWizardMediaFile,
  setCropHandle,
  solveHomography,
} from '../src/purchase-wizard/media-utils.js';
import type { WizardMedia } from '../src/purchase-wizard/types.js';

describe('non-destructive crop recipes', () => {
  it('infers common camera and document MIME types when File.type is missing', () => {
    expect(inferMediaMime('IMG_0001.HEIC', '')).toBe('image/heic');
    expect(inferMediaMime('invoice.pdf', '')).toBe('application/pdf');
    expect(inferMediaMime('photo.jpg', 'image/jpeg; charset=binary')).toBe('image/jpeg');
  });

  it('treats a reselected file as a new immutable original', () => {
    const previous: WizardMedia = {
      id: 'photo-server-original',
      kind: 'ASSET_PHOTO',
      source: 'LIBRARY',
      targetItemId: 'item-2',
      attachmentType: 'serial',
      description: '序號近照',
      filename: 'old.png',
      mime: 'image/png',
      sizeBytes: 3,
      needsReselection: true,
      serverAttachmentStatus: 'READY',
      crop: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
      createdAt: '2026-07-28T00:00:00.000Z',
    };

    const replacement = replaceWizardMediaFile(
      previous,
      new File([new Uint8Array([1, 2, 3, 4])], 'different.png', {
        type: 'image/png',
        lastModified: 123,
      }),
      'LIBRARY',
    );

    expect(replacement.id).not.toBe(previous.id);
    expect(replacement).toEqual(
      expect.objectContaining({
        filename: 'different.png',
        targetItemId: 'item-2',
        attachmentType: 'serial',
        source: 'LIBRARY',
        description: '序號近照',
        needsReselection: false,
        serverAttachmentStatus: undefined,
        crop: DEFAULT_CROP_RECT,
      }),
    );
    if (replacement.previewUrl) URL.revokeObjectURL(replacement.previewUrl);
  });

  it('persists the defaults shown by untouched photo and document type selects', () => {
    const photo = createWizardMedia(
      new File([new Uint8Array([1])], 'front.png', { type: 'image/png' }),
      'ASSET_PHOTO',
      'CAMERA',
    );
    const document = createWizardMedia(
      new File([new Uint8Array([1])], 'invoice.png', { type: 'image/png' }),
      'DOCUMENT',
      'LIBRARY',
    );

    expect(photo.attachmentType).toBe('front');
    expect(document.documentType).toBe('invoice');
    expect(buildAttachmentReviewPayload(photo, 0, 1).kind).toBe('front');
    expect(buildAttachmentReviewPayload(document, 0, 1).kind).toBe('invoice');

    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    if (document.previewUrl) URL.revokeObjectURL(document.previewUrl);
  });

  it('records a reselected camera original as a library file', () => {
    const previous: WizardMedia = {
      id: 'camera-original',
      kind: 'ASSET_PHOTO',
      source: 'CAMERA',
      attachmentType: 'front',
      filename: 'camera.jpg',
      mime: 'image/jpeg',
      sizeBytes: 1,
      needsReselection: true,
      createdAt: '2026-07-28T00:00:00.000Z',
    };

    const replacement = replaceWizardMediaFile(
      previous,
      new File([new Uint8Array([2])], 'library.jpg', { type: 'image/jpeg' }),
      'LIBRARY',
    );

    expect(replacement.source).toBe('LIBRARY');
    if (replacement.previewUrl) URL.revokeObjectURL(replacement.previewUrl);
  });

  it('repairs missing media type defaults when an older draft reselects its file', () => {
    const previousDocument: WizardMedia = {
      id: 'legacy-document',
      kind: 'DOCUMENT',
      source: 'CAMERA',
      filename: 'legacy.jpg',
      mime: 'image/jpeg',
      sizeBytes: 1,
      needsReselection: true,
      createdAt: '2026-07-28T00:00:00.000Z',
    };

    const replacement = replaceWizardMediaFile(
      previousDocument,
      new File([new Uint8Array([3])], 'invoice.jpg', { type: 'image/jpeg' }),
      'LIBRARY',
    );

    expect(replacement.documentType).toBe('invoice');
    expect(buildAttachmentReviewPayload(replacement, 0, 1).kind).toBe('invoice');
    if (replacement.previewUrl) URL.revokeObjectURL(replacement.previewUrl);
  });

  it('builds a versioned READY attachment metadata update before finalize', () => {
    const media: WizardMedia = {
      id: 'photo-1',
      kind: 'ASSET_PHOTO',
      source: 'CAMERA',
      targetItemId: 'item-3',
      isPrimary: true,
      attachmentType: 'security',
      description: '  防偽標誌  ',
      filename: 'security.jpg',
      mime: 'image/jpeg',
      sizeBytes: 200,
      needsReselection: true,
      serverAttachmentStatus: 'READY',
      createdAt: '2026-07-28T00:00:00.000Z',
    };

    expect(buildAttachmentReviewPayload(media, 0, 7)).toEqual({
      version: 7,
      kind: 'security',
      mediaClass: 'ASSET_PHOTO',
      draftItemId: 'item-3',
      processingMode: 'OBJECT_CROP',
      processingMetadata: undefined,
      userConfirmed: true,
      description: '防偽標誌',
      isCover: true,
    });
  });

  it('does not mark the first upload as cover when another photo is explicitly primary', () => {
    const media: WizardMedia = {
      id: 'photo-secondary',
      kind: 'ASSET_PHOTO',
      source: 'CAMERA',
      targetItemId: 'item-3',
      isPrimary: false,
      attachmentType: 'front',
      filename: 'front.jpg',
      mime: 'image/jpeg',
      sizeBytes: 200,
      needsReselection: false,
      createdAt: '2026-07-28T00:00:00.000Z',
    };

    expect(buildAttachmentReviewPayload(media, 0, 1).isCover).toBe(false);
  });

  it('moves a crop corner and enforces image bounds plus a minimum size', () => {
    const moved = setCropHandle(DEFAULT_CROP_RECT, 'topLeft', { x: -1, y: -1 });
    expect(moved).toMatchObject({ x: 0, y: 0 });

    const collapsed = setCropHandle(DEFAULT_CROP_RECT, 'topLeft', { x: 0.99, y: 0.99 });
    expect(collapsed.width).toBeGreaterThanOrEqual(0.08 - Number.EPSILON);
    expect(collapsed.height).toBeGreaterThanOrEqual(0.08 - Number.EPSILON);

    const keyboardMoved = moveCropHandle(DEFAULT_CROP_RECT, 'bottomRight', 0.01, -0.02);
    expect(keyboardMoved.width).toBeCloseTo(0.91);
    expect(keyboardMoved.height).toBeCloseTo(0.88);
  });

  it('clamps document corners without mutating the original recipe', () => {
    const moved = moveDocumentCorner(DEFAULT_DOCUMENT_CORNERS, 'topLeft', -1, 0.1);
    expect(moved.topLeft).toEqual({ x: 0, y: 0.16 });
    expect(DEFAULT_DOCUMENT_CORNERS.topLeft).toEqual({ x: 0.06, y: 0.06 });
  });
});

describe('perspective correction scaffold', () => {
  it('solves an identity projective transform', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const matrix = solveHomography(square, square);
    expect(projectPoint(matrix, { x: 25, y: 75 })).toEqual(
      expect.objectContaining({ x: expect.closeTo(25, 8), y: expect.closeTo(75, 8) }),
    );
  });

  it('creates a bounded inverse mapping from output pixels to source corners', () => {
    const plan = createPerspectivePlan(DEFAULT_DOCUMENT_CORNERS, 4000, 3000, 1000);
    expect(Math.max(plan.outputWidth, plan.outputHeight)).toBeLessThanOrEqual(1000);
    const topLeft = projectPoint(plan.destinationToSource, { x: 0, y: 0 });
    const bottomRight = projectPoint(plan.destinationToSource, {
      x: plan.outputWidth - 1,
      y: plan.outputHeight - 1,
    });
    expect(topLeft.x).toBeCloseTo(240, 4);
    expect(topLeft.y).toBeCloseTo(180, 4);
    expect(bottomRight.x).toBeCloseTo(3760, 4);
    expect(bottomRight.y).toBeCloseTo(2820, 4);
  });
});
