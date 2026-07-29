import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const webRoot = new URL('../', import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, webRoot), 'utf8');
}

function pngDimensions(relativePath: string): [number, number] {
  const bytes = readFileSync(new URL(relativePath, webRoot));
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('Apple web app metadata', () => {
  it('declares a stable standalone manifest and a dedicated maskable icon', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
      id: string;
      display: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };

    expect(manifest).toMatchObject({
      id: '/',
      display: 'standalone',
      start_url: '/',
      scope: '/',
    });
    expect(manifest.icons).toContainEqual(
      expect.objectContaining({
        src: '/bullion-ledger-icon-1024.png',
        sizes: '1024x1024',
        purpose: 'maskable',
      }),
    );
  });

  it('provides iPhone, iPad, and Mac Safari metadata', () => {
    const html = read('index.html');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="format-detection" content="telephone=no"');
    expect(html).toContain('sizes="120x120" href="/apple-touch-icon-120.png"');
    expect(html).toContain('sizes="152x152" href="/apple-touch-icon-152.png"');
    expect(html).toContain('sizes="167x167" href="/apple-touch-icon-167.png"');
    expect(html).toContain('rel="mask-icon" href="/safari-pinned-tab.svg"');
  });

  it.each([
    ['public/bullion-ledger-icon-32.png', 32],
    ['public/apple-touch-icon-120.png', 120],
    ['public/apple-touch-icon-152.png', 152],
    ['public/apple-touch-icon-167.png', 167],
    ['public/apple-touch-icon.png', 180],
    ['public/bullion-ledger-icon-1024.png', 1024],
  ])('generates %s at %dpx', (path, size) => {
    expect(pngDimensions(path)).toEqual([size, size]);
  });

  it('limits service-worker cache cleanup and runtime caching to app-owned assets', () => {
    const worker = read('public/sw.js');
    expect(worker).toContain('key.startsWith(CACHE_PREFIX)');
    expect(worker).toContain("url.pathname.startsWith('/assets/')");
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("url.searchParams.has('X-Amz-Signature')");
    expect(worker).toContain("event.data?.type === 'SKIP_WAITING'");
  });

  it('only offers a reload-based update from the safe dashboard screen', () => {
    const app = read('src/App.tsx');
    const notice = read('src/PwaUpdateNotice.tsx');

    expect(app).toContain("screen === 'dashboard' && <PwaUpdateNotice />");
    expect(notice).toContain('立即更新會重新啟動 App');
    expect(notice).not.toContain('不遺失草稿');
  });
});
