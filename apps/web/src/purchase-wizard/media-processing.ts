import { renderPerspectiveCorrection } from './media-utils.js';
import type { DocumentCorners, NormalizedCropRect } from './types.js';

export interface CropPixelPlan {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export function createCropPixelPlan(
  crop: NormalizedCropRect,
  imageWidth: number,
  imageHeight: number,
  maxOutputSide = 2048,
): CropPixelPlan {
  if (imageWidth <= 0 || imageHeight <= 0 || maxOutputSide <= 0) {
    throw new Error('裁切尺寸必須大於零。');
  }
  const left = clamp(crop.x);
  const top = clamp(crop.y);
  const right = clamp(crop.x + crop.width);
  const bottom = clamp(crop.y + crop.height);
  if (right <= left || bottom <= top) throw new Error('裁切範圍無效。');
  const sourceX = Math.floor(left * imageWidth);
  const sourceY = Math.floor(top * imageHeight);
  const sourceWidth = Math.max(1, Math.ceil(right * imageWidth) - sourceX);
  const sourceHeight = Math.max(1, Math.ceil(bottom * imageHeight) - sourceY);
  const scale = Math.min(1, maxOutputSide / Math.max(sourceWidth, sourceHeight));
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth: Math.max(1, Math.round(sourceWidth * scale)),
    outputHeight: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/** Produces a normalized JPEG derivative while preserving the original File. */
export async function renderCroppedPhoto(file: File, crop: NormalizedCropRect): Promise<Blob> {
  return withFileImage(file, async (image) => {
    const plan = createCropPixelPlan(crop, image.naturalWidth, image.naturalHeight);
    const output = document.createElement('canvas');
    output.width = plan.outputWidth;
    output.height = plan.outputHeight;
    const context = output.getContext('2d');
    if (!context) throw new Error('瀏覽器無法建立裁切圖。');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      plan.sourceX,
      plan.sourceY,
      plan.sourceWidth,
      plan.sourceHeight,
      0,
      0,
      output.width,
      output.height,
    );
    return canvasToJpeg(output);
  });
}

/** Applies the confirmed four-corner projective transform and light scan enhancement. */
export async function renderDocumentScan(file: File, corners: DocumentCorners): Promise<Blob> {
  return withFileImage(file, async (image) => {
    const maxSourceSide = 2200;
    const scale = Math.min(1, maxSourceSide / Math.max(image.naturalWidth, image.naturalHeight));
    const source = document.createElement('canvas');
    source.width = Math.max(1, Math.round(image.naturalWidth * scale));
    source.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const sourceContext = source.getContext('2d');
    if (!sourceContext) throw new Error('瀏覽器無法建立文件圖。');
    sourceContext.drawImage(image, 0, 0, source.width, source.height);

    const corrected = renderPerspectiveCorrection(source, corners, 1800);
    const enhanced = document.createElement('canvas');
    enhanced.width = corrected.width;
    enhanced.height = corrected.height;
    const enhancedContext = enhanced.getContext('2d');
    if (!enhancedContext) throw new Error('瀏覽器無法建立掃描圖。');
    enhancedContext.filter = 'contrast(1.08) brightness(1.03)';
    enhancedContext.drawImage(corrected, 0, 0);
    return canvasToJpeg(enhanced);
  });
}

/** Prevents a selected image from being uploaded when this browser cannot produce its derivative. */
export async function canDecodeWizardImage(file: File): Promise<boolean> {
  try {
    return await withFileImage(
      file,
      async (image) => image.naturalWidth > 0 && image.naturalHeight > 0,
    );
  } catch {
    return false;
  }
}

async function withFileImage<T>(
  file: File,
  use: (image: HTMLImageElement) => Promise<T>,
): Promise<T> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return await use(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('此瀏覽器無法解碼圖片，請改用 JPEG、PNG 或 WebP。'));
    image.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('無法輸出處理後的 JPEG。'))),
      'image/jpeg',
      0.9,
    );
  });
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
