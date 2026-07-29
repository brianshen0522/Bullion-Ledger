import type { DocumentCorners, NormalizedCropRect, NormalizedPoint } from './types.js';

export interface PixelBuffer {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface AutoDetection<T> {
  value: T;
  confidence: number;
  foregroundRatio: number;
}

interface Component {
  pixels: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  score: number;
}

const MIN_COMPONENT_RATIO = 0.006;

/**
 * Finds the largest coherent region that differs from the image border. This
 * deliberately runs locally and returns an editable recipe; it never replaces
 * the source photo. A server-side vision worker can later refine the same
 * normalized rectangle without changing the attachment contract.
 */
export function detectObjectCrop(buffer: PixelBuffer): AutoDetection<NormalizedCropRect> | null {
  const component = detectForegroundComponent(buffer);
  if (!component) return null;
  const paddingX = Math.max(2, Math.round((component.maxX - component.minX + 1) * 0.055));
  const paddingY = Math.max(2, Math.round((component.maxY - component.minY + 1) * 0.055));
  const left = Math.max(0, component.minX - paddingX);
  const top = Math.max(0, component.minY - paddingY);
  const right = Math.min(buffer.width - 1, component.maxX + paddingX);
  const bottom = Math.min(buffer.height - 1, component.maxY + paddingY);

  return {
    value: {
      x: left / buffer.width,
      y: top / buffer.height,
      width: (right - left + 1) / buffer.width,
      height: (bottom - top + 1) / buffer.height,
    },
    confidence: componentConfidence(component, buffer),
    foregroundRatio: component.pixels.length / (buffer.width * buffer.height),
  };
}

/** Detects a document quadrilateral from the same border/foreground model. */
export function detectDocumentCorners(buffer: PixelBuffer): AutoDetection<DocumentCorners> | null {
  const component = detectForegroundComponent(buffer);
  if (!component || component.pixels.length < 16) return null;

  const points = component.pixels.map((index) => ({
    x: index % buffer.width,
    y: Math.floor(index / buffer.width),
  }));
  const sampleCount = Math.max(2, Math.min(12, Math.round(Math.sqrt(points.length) * 0.035)));
  const topLeft = averageExtreme(points, (point) => -(point.x + point.y), sampleCount);
  const topRight = averageExtreme(points, (point) => point.x - point.y, sampleCount);
  const bottomRight = averageExtreme(points, (point) => point.x + point.y, sampleCount);
  const bottomLeft = averageExtreme(points, (point) => point.y - point.x, sampleCount);

  const normalized: DocumentCorners = {
    topLeft: normalizePoint(topLeft, buffer),
    topRight: normalizePoint(topRight, buffer),
    bottomRight: normalizePoint(bottomRight, buffer),
    bottomLeft: normalizePoint(bottomLeft, buffer),
  };
  if (!isUsableQuadrilateral(normalized)) return null;

  return {
    value: normalized,
    confidence: componentConfidence(component, buffer),
    foregroundRatio: component.pixels.length / (buffer.width * buffer.height),
  };
}

/** Extracts a capped pixel buffer from an already-loaded same-origin/blob image. */
export function pixelsFromImage(image: HTMLImageElement, maxSide = 320): PixelBuffer {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('圖片尚未載入完成。');
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('瀏覽器無法讀取圖片像素。');
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function detectForegroundComponent(buffer: PixelBuffer): Component | null {
  if (
    buffer.width < 8 ||
    buffer.height < 8 ||
    buffer.data.length < buffer.width * buffer.height * 4
  ) {
    return null;
  }
  const border = borderStatistics(buffer);
  const threshold = Math.min(110, Math.max(20, border.meanDistance + border.stdDistance * 3.2));
  const mask = new Uint8Array(buffer.width * buffer.height);
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const index = y * buffer.width + x;
      const offset = index * 4;
      const alpha = Number(buffer.data[offset + 3] ?? 255) / 255;
      if (alpha < 0.2) continue;
      const distance = colorDistance(
        Number(buffer.data[offset] ?? 0),
        Number(buffer.data[offset + 1] ?? 0),
        Number(buffer.data[offset + 2] ?? 0),
        border.red,
        border.green,
        border.blue,
      );
      if (distance > threshold) mask[index] = 1;
    }
  }

  // Close single-pixel gaps while avoiding broad expansion into the background.
  const closed = closeMask(mask, buffer.width, buffer.height);
  const visited = new Uint8Array(closed.length);
  const components: Component[] = [];
  const minimumArea = Math.max(12, Math.round(closed.length * MIN_COMPONENT_RATIO));

  for (let start = 0; start < closed.length; start += 1) {
    if (!closed[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    const pixels: number[] = [];
    let minX = buffer.width;
    let minY = buffer.height;
    let maxX = 0;
    let maxY = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      pixels.push(current);
      const x = current % buffer.width;
      const y = Math.floor(current / buffer.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const neighbour of neighbours(current, x, y, buffer.width, buffer.height)) {
        if (!closed[neighbour] || visited[neighbour]) continue;
        visited[neighbour] = 1;
        queue.push(neighbour);
      }
    }
    if (pixels.length < minimumArea) continue;
    const centerX = (minX + maxX) / 2 / buffer.width;
    const centerY = (minY + maxY) / 2 / buffer.height;
    const centerDistance = Math.hypot(centerX - 0.5, centerY - 0.5) / Math.SQRT1_2;
    const touches =
      Number(minX === 0) +
      Number(minY === 0) +
      Number(maxX === buffer.width - 1) +
      Number(maxY === buffer.height - 1);
    const score =
      pixels.length * (1.15 - Math.min(0.55, centerDistance * 0.35)) * (1 - touches * 0.08);
    components.push({ pixels, minX, minY, maxX, maxY, score });
  }
  return components.sort((left, right) => right.score - left.score)[0] ?? null;
}

function borderStatistics(buffer: PixelBuffer) {
  const thickness = Math.max(1, Math.round(Math.min(buffer.width, buffer.height) * 0.035));
  const samples: [number, number, number][] = [];
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      if (
        x >= thickness &&
        x < buffer.width - thickness &&
        y >= thickness &&
        y < buffer.height - thickness
      )
        continue;
      const offset = (y * buffer.width + x) * 4;
      samples.push([
        Number(buffer.data[offset] ?? 0),
        Number(buffer.data[offset + 1] ?? 0),
        Number(buffer.data[offset + 2] ?? 0),
      ]);
    }
  }
  const red = median(samples.map((sample) => sample[0]));
  const green = median(samples.map((sample) => sample[1]));
  const blue = median(samples.map((sample) => sample[2]));
  const distances = samples.map((sample) =>
    colorDistance(sample[0], sample[1], sample[2], red, green, blue),
  );
  const meanDistance = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const variance =
    distances.reduce((sum, value) => sum + (value - meanDistance) ** 2, 0) / distances.length;
  return { red, green, blue, meanDistance, stdDistance: Math.sqrt(variance) };
}

function closeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const dilated = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      let neighboursSet = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) neighboursSet += mask[index + dy * width + dx]!;
      }
      if (neighboursSet >= 3) dilated[index] = 1;
    }
  }
  const closed = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      let neighboursSet = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) neighboursSet += dilated[index + dy * width + dx]!;
      }
      if (neighboursSet >= 4) closed[index] = 1;
    }
  }
  return closed;
}

function neighbours(index: number, x: number, y: number, width: number, height: number): number[] {
  const values: number[] = [];
  if (x > 0) values.push(index - 1);
  if (x + 1 < width) values.push(index + 1);
  if (y > 0) values.push(index - width);
  if (y + 1 < height) values.push(index + width);
  return values;
}

function averageExtreme(
  points: NormalizedPoint[],
  score: (point: NormalizedPoint) => number,
  count: number,
): NormalizedPoint {
  const selected = [...points].sort((left, right) => score(right) - score(left)).slice(0, count);
  return {
    x: selected.reduce((sum, point) => sum + point.x, 0) / selected.length,
    y: selected.reduce((sum, point) => sum + point.y, 0) / selected.length,
  };
}

function normalizePoint(point: NormalizedPoint, buffer: PixelBuffer): NormalizedPoint {
  return {
    x: clamp(point.x / Math.max(1, buffer.width - 1)),
    y: clamp(point.y / Math.max(1, buffer.height - 1)),
  };
}

function isUsableQuadrilateral(corners: DocumentCorners): boolean {
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const area = Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
  const minimumEdge = Math.min(
    ...points.map((point, index) => {
      const next = points[(index + 1) % points.length]!;
      return Math.hypot(next.x - point.x, next.y - point.y);
    }),
  );
  return area >= 0.035 && minimumEdge >= 0.08;
}

function componentConfidence(component: Component, buffer: PixelBuffer): number {
  const ratio = component.pixels.length / (buffer.width * buffer.height);
  const occupancy =
    component.pixels.length /
    ((component.maxX - component.minX + 1) * (component.maxY - component.minY + 1));
  return clamp(0.42 + Math.min(0.28, ratio * 0.75) + Math.min(0.25, occupancy * 0.25), 0, 0.95);
}

function colorDistance(
  red: number,
  green: number,
  blue: number,
  backgroundRed: number,
  backgroundGreen: number,
  backgroundBlue: number,
): number {
  return Math.sqrt(
    (red - backgroundRed) ** 2 + (green - backgroundGreen) ** 2 + (blue - backgroundBlue) ** 2,
  );
}

function median(values: number[]): number {
  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}
