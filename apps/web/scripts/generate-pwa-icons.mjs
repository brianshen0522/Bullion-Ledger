import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const outputs = [
  ['bullion-ledger-icon-32.png', 32],
  ['bullion-ledger-icon-192.png', 192],
  ['bullion-ledger-icon-512.png', 512],
  ['bullion-ledger-icon-1024.png', 1024],
  ['apple-touch-icon-120.png', 120],
  ['apple-touch-icon-152.png', 152],
  ['apple-touch-icon-167.png', 167],
  ['apple-touch-icon.png', 180],
];

for (const [filename, size] of outputs) {
  await writeFile(resolve('public', filename), encodePng(size, size, renderIcon(size)));
}

function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const scale = size / 512;
  const body = [
    [112, 328],
    [166, 184],
    [346, 184],
    [400, 328],
    [366, 370],
    [146, 370],
  ];
  const top = [
    [166, 184],
    [346, 184],
    [306, 266],
    [206, 266],
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const point = [(x + 0.5) / scale, (y + 0.5) / scale];
      let color = [15, 118, 110, 255];
      if (pointInPolygon(point, body)) color = [248, 213, 107, 255];
      if (distanceToPolygon(point, body) <= 9) color = [255, 247, 214, 255];
      if (pointInPolygon(point, body) && distanceToPolygon(point, body) > 9) {
        color = [248, 213, 107, 255];
      }
      if (pointInPolygon(point, top)) color = [255, 231, 153, 255];
      if (distanceToSegment(point, [156, 326], [356, 326]) <= 9) {
        color = [154, 100, 0, 255];
      }
      const circleDistance = Math.hypot(point[0] - 256, point[1] - 284);
      if (circleDistance >= 27 && circleDistance <= 41) color = [154, 100, 0, 255];
      const offset = (y * size + x) * 4;
      pixels.set(color, offset);
    }
  }
  return pixels;
}

function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [currentX, currentY] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    if (
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolygon(point, polygon) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    minimum = Math.min(
      minimum,
      distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]),
    );
  }
  return minimum;
}

function distanceToSegment([x, y], [x1, y1], [x2, y2]) {
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  const ratio = lengthSquared
    ? Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSquared))
    : 0;
  return Math.hypot(x - (x1 + ratio * (x2 - x1)), y - (y1 + ratio * (y2 - y1)));
}

function encodePng(width, height, pixels) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(
      scanlines,
      target + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk(
      'IHDR',
      Buffer.from([
        (width >>> 24) & 255,
        (width >>> 16) & 255,
        (width >>> 8) & 255,
        width & 255,
        (height >>> 24) & 255,
        (height >>> 16) & 255,
        (height >>> 8) & 255,
        height & 255,
        8,
        6,
        0,
        0,
        0,
      ]),
    ),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
