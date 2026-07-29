import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return extname(entry.name) === '.tsx' ? [path] : [];
  });
}

describe('custom select coverage', () => {
  it('does not use browser-native select controls in the application', () => {
    const nativeSelectFiles = collectTsxFiles(sourceRoot)
      .filter((path) => /<select\b/i.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(sourceRoot.length + 1));

    expect(nativeSelectFiles).toEqual([]);
  });
});
