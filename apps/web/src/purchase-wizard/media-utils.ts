import { createStableId } from './model.js';
import type {
  DocumentCorners,
  NormalizedCropRect,
  NormalizedPoint,
  WizardMedia,
  WizardMediaKind,
  WizardMediaSource,
} from './types.js';

export const DEFAULT_CROP_RECT: NormalizedCropRect = {
  x: 0.05,
  y: 0.05,
  width: 0.9,
  height: 0.9,
};

export const DEFAULT_DOCUMENT_CORNERS: DocumentCorners = {
  topLeft: { x: 0.06, y: 0.06 },
  topRight: { x: 0.94, y: 0.06 },
  bottomRight: { x: 0.94, y: 0.94 },
  bottomLeft: { x: 0.06, y: 0.94 },
};

export type CropHandle = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';
export type DocumentCorner = keyof DocumentCorners;

const MIN_CROP_SIZE = 0.08;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function setCropHandle(
  rect: NormalizedCropRect,
  handle: CropHandle,
  point: NormalizedPoint,
): NormalizedCropRect {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const x = clamp(point.x);
  const y = clamp(point.y);

  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;
  if (handle === 'topLeft' || handle === 'bottomLeft') {
    nextLeft = Math.min(x, right - MIN_CROP_SIZE);
  } else {
    nextRight = Math.max(x, left + MIN_CROP_SIZE);
  }
  if (handle === 'topLeft' || handle === 'topRight') {
    nextTop = Math.min(y, bottom - MIN_CROP_SIZE);
  } else {
    nextBottom = Math.max(y, top + MIN_CROP_SIZE);
  }
  return {
    x: clamp(nextLeft),
    y: clamp(nextTop),
    width: clamp(nextRight) - clamp(nextLeft),
    height: clamp(nextBottom) - clamp(nextTop),
  };
}

export function moveCropHandle(
  rect: NormalizedCropRect,
  handle: CropHandle,
  deltaX: number,
  deltaY: number,
): NormalizedCropRect {
  const point = cropHandlePoint(rect, handle);
  return setCropHandle(rect, handle, { x: point.x + deltaX, y: point.y + deltaY });
}

export function cropHandlePoint(rect: NormalizedCropRect, handle: CropHandle): NormalizedPoint {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  switch (handle) {
    case 'topLeft':
      return { x: rect.x, y: rect.y };
    case 'topRight':
      return { x: right, y: rect.y };
    case 'bottomRight':
      return { x: right, y: bottom };
    case 'bottomLeft':
      return { x: rect.x, y: bottom };
  }
}

export function setDocumentCorner(
  corners: DocumentCorners,
  corner: DocumentCorner,
  point: NormalizedPoint,
): DocumentCorners {
  return {
    ...corners,
    [corner]: { x: clamp(point.x), y: clamp(point.y) },
  };
}

export function moveDocumentCorner(
  corners: DocumentCorners,
  corner: DocumentCorner,
  deltaX: number,
  deltaY: number,
): DocumentCorners {
  const point = corners[corner];
  return setDocumentCorner(corners, corner, {
    x: point.x + deltaX,
    y: point.y + deltaY,
  });
}

export function createWizardMedia(
  file: File,
  kind: WizardMediaKind,
  source: WizardMediaSource,
  options: {
    id?: string;
    targetItemId?: string;
    attachmentType?: string;
    documentType?: string;
    now?: Date;
  } = {},
): WizardMedia {
  const filename = file.name || `${kind === 'DOCUMENT' ? 'document' : 'photo'}.jpg`;
  const mime = inferMediaMime(filename, file.type);
  const previewUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(file)
      : undefined;
  return {
    id: options.id ?? createStableId(kind === 'DOCUMENT' ? 'document' : 'photo'),
    kind,
    source,
    targetItemId: options.targetItemId,
    attachmentType: kind === 'ASSET_PHOTO' ? (options.attachmentType ?? 'front') : undefined,
    documentType: kind === 'DOCUMENT' ? (options.documentType ?? 'invoice') : undefined,
    filename,
    mime,
    sizeBytes: file.size,
    lastModified: file.lastModified,
    originalFile: file,
    previewUrl,
    needsReselection: false,
    crop: kind === 'ASSET_PHOTO' ? { ...DEFAULT_CROP_RECT } : undefined,
    documentCorners:
      kind === 'DOCUMENT' && mime.startsWith('image/')
        ? cloneDocumentCorners(DEFAULT_DOCUMENT_CORNERS)
        : undefined,
    createdAt: (options.now ?? new Date()).toISOString(),
  };
}

/**
 * A reselected file is a new immutable original, not a new derivative of the
 * attachment already on the server. Give it a new client id so synchronization
 * deletes the old attachment and performs a fresh upload with a fresh
 * idempotency key.
 */
export function replaceWizardMediaFile(
  media: WizardMedia,
  file: File,
  source: WizardMediaSource,
): WizardMedia {
  const replacement = createWizardMedia(file, media.kind, source, {
    targetItemId: media.targetItemId,
    attachmentType: media.attachmentType,
    documentType: media.documentType,
  });
  return {
    ...media,
    ...replacement,
    attachmentType: media.attachmentType ?? replacement.attachmentType,
    documentType: media.documentType ?? replacement.documentType,
    description: media.description,
    targetItemId: media.targetItemId,
    serverAttachmentStatus: undefined,
  };
}

export function attachmentKind(media: WizardMedia): string {
  return media.kind === 'DOCUMENT'
    ? (media.documentType ?? 'document')
    : (media.attachmentType ?? 'asset');
}

/** Metadata sent even for an already-READY server attachment before finalize. */
export function buildAttachmentReviewPayload(
  media: WizardMedia,
  index: number,
  version: number,
  processingMetadata?: Record<string, unknown>,
) {
  return {
    version,
    kind: attachmentKind(media),
    mediaClass: media.kind,
    draftItemId: media.targetItemId ?? null,
    processingMode:
      media.kind === 'DOCUMENT'
        ? media.mime === 'application/pdf'
          ? 'NONE'
          : 'DOCUMENT_SCAN'
        : 'OBJECT_CROP',
    processingMetadata,
    userConfirmed: true,
    description: media.description?.trim() || null,
    isCover:
      media.kind === 'ASSET_PHOTO' &&
      (media.isPrimary === true || (media.isPrimary === undefined && index === 0)),
  } as const;
}

export function inferMediaMime(filename: string, declaredMime: string): string {
  const normalized = declaredMime.split(';', 1)[0]!.trim().toLowerCase();
  if (normalized) return normalized;
  const extension = filename.split('.').pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf',
  };
  return (extension && byExtension[extension]) || 'application/octet-stream';
}

export function revokeWizardMediaPreview(media: WizardMedia): void {
  if (
    media.previewUrl &&
    media.previewUrl.startsWith('blob:') &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    URL.revokeObjectURL(media.previewUrl);
  }
}

function cloneDocumentCorners(corners: DocumentCorners): DocumentCorners {
  return {
    topLeft: { ...corners.topLeft },
    topRight: { ...corners.topRight },
    bottomRight: { ...corners.bottomRight },
    bottomLeft: { ...corners.bottomLeft },
  };
}

function distance(left: NormalizedPoint, right: NormalizedPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export interface PerspectivePlan {
  sourcePoints: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
  outputWidth: number;
  outputHeight: number;
  /** Inverse homography mapping destination pixels to source pixels. */
  destinationToSource: readonly number[];
}

export function createPerspectivePlan(
  corners: DocumentCorners,
  sourceWidth: number,
  sourceHeight: number,
  maxOutputSide = 2048,
): PerspectivePlan {
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxOutputSide <= 0) {
    throw new Error('Perspective dimensions must be positive.');
  }
  const normalized: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  const sourcePoints = normalized.map((point) => ({
    x: clamp(point.x) * sourceWidth,
    y: clamp(point.y) * sourceHeight,
  })) as [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];

  const topWidth = distance(sourcePoints[0], sourcePoints[1]);
  const bottomWidth = distance(sourcePoints[3], sourcePoints[2]);
  const leftHeight = distance(sourcePoints[0], sourcePoints[3]);
  const rightHeight = distance(sourcePoints[1], sourcePoints[2]);
  let outputWidth = Math.max(1, Math.round(Math.max(topWidth, bottomWidth)));
  let outputHeight = Math.max(1, Math.round(Math.max(leftHeight, rightHeight)));
  const scale = Math.min(1, maxOutputSide / Math.max(outputWidth, outputHeight));
  outputWidth = Math.max(1, Math.round(outputWidth * scale));
  outputHeight = Math.max(1, Math.round(outputHeight * scale));

  const destination: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 },
  ];
  return {
    sourcePoints,
    outputWidth,
    outputHeight,
    destinationToSource: solveHomography(destination, sourcePoints),
  };
}

/** Solve the eight free coefficients of a 3×3 projective transform. */
export function solveHomography(
  from: readonly NormalizedPoint[],
  to: readonly NormalizedPoint[],
): readonly number[] {
  if (from.length !== 4 || to.length !== 4) throw new Error('Homography requires four points.');
  const matrix: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const source = from[index]!;
    const destination = to[index]!;
    matrix.push([
      source.x,
      source.y,
      1,
      0,
      0,
      0,
      -destination.x * source.x,
      -destination.x * source.y,
      destination.x,
    ]);
    matrix.push([
      0,
      0,
      0,
      source.x,
      source.y,
      1,
      -destination.y * source.x,
      -destination.y * source.y,
      destination.y,
    ]);
  }
  const coefficients = gaussianElimination(matrix);
  return [...coefficients, 1];
}

function gaussianElimination(augmented: number[][]): number[] {
  const size = 8;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-10) {
      throw new Error('Document corners do not form a usable quadrilateral.');
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    for (let cell = column; cell <= size; cell += 1) {
      augmented[column]![cell] = augmented[column]![cell]! / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let cell = column; cell <= size; cell += 1) {
        augmented[row]![cell] = augmented[row]![cell]! - factor * augmented[column]![cell]!;
      }
    }
  }
  return augmented.map((row) => row[size]!);
}

export function projectPoint(matrix: readonly number[], point: NormalizedPoint): NormalizedPoint {
  if (matrix.length !== 9) throw new Error('A homography matrix must have nine values.');
  const denominator = matrix[6]! * point.x + matrix[7]! * point.y + matrix[8]!;
  if (Math.abs(denominator) < 1e-10) throw new Error('Point projects to infinity.');
  return {
    x: (matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!) / denominator,
    y: (matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!) / denominator,
  };
}

/**
 * CPU reference implementation for a corrected preview. Production can swap
 * this for WebGL/OpenCV in a Worker while preserving the same corner recipe.
 */
export function renderPerspectiveCorrection(
  source: HTMLCanvasElement,
  corners: DocumentCorners,
  maxOutputSide = 1600,
): HTMLCanvasElement {
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Canvas 2D context is unavailable.');
  const plan = createPerspectivePlan(corners, source.width, source.height, maxOutputSide);
  const output = document.createElement('canvas');
  output.width = plan.outputWidth;
  output.height = plan.outputHeight;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Canvas 2D context is unavailable.');
  const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height);
  const outputPixels = outputContext.createImageData(output.width, output.height);
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const mapped = projectPoint(plan.destinationToSource, { x, y });
      const sourceX = Math.min(source.width - 1, Math.max(0, Math.round(mapped.x)));
      const sourceY = Math.min(source.height - 1, Math.max(0, Math.round(mapped.y)));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const outputOffset = (y * output.width + x) * 4;
      outputPixels.data[outputOffset] = sourcePixels.data[sourceOffset]!;
      outputPixels.data[outputOffset + 1] = sourcePixels.data[sourceOffset + 1]!;
      outputPixels.data[outputOffset + 2] = sourcePixels.data[sourceOffset + 2]!;
      outputPixels.data[outputOffset + 3] = sourcePixels.data[sourceOffset + 3]!;
    }
  }
  outputContext.putImageData(outputPixels, 0, 0);
  return output;
}
