import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { LOCKED_VIEWPORT, lockZoom } from '../src/zoom-lock.js';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8').replace(
  /\s+/g,
  ' ',
);
const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('../src/main.tsx', import.meta.url)), 'utf8');

function fakeDocument() {
  const listeners: { name: string; fn: EventListener; options?: unknown }[] = [];
  return {
    listeners,
    addEventListener: vi.fn((name: string, fn: EventListener, options?: unknown) => {
      listeners.push({ name, fn, options });
    }),
    removeEventListener: vi.fn((name: string, fn: EventListener) => {
      const index = listeners.findIndex((l) => l.name === name && l.fn === fn);
      if (index >= 0) listeners.splice(index, 1);
    }),
  };
}

function fire(doc: ReturnType<typeof fakeDocument>, name: string, event: Partial<Event>) {
  const preventDefault = vi.fn();
  for (const l of doc.listeners.filter((entry) => entry.name === name)) {
    l.fn({ preventDefault, ...event } as unknown as Event);
  }
  return preventDefault;
}

/**
 * No single mechanism holds a web app at 1x everywhere: Chrome honours the
 * viewport meta, CSS declines the gestures, and iOS Safari in a browser tab
 * ignores both and needs its proprietary gesture events cancelled.
 */
describe('zoom lock', () => {
  it('declares a non-scalable viewport that still covers the notch', () => {
    expect(LOCKED_VIEWPORT).toContain('user-scalable=no');
    expect(LOCKED_VIEWPORT).toContain('maximum-scale=1');
    // Dropping viewport-fit=cover would re-introduce letterboxing on a notched
    // phone and strip every safe-area inset the layout depends on.
    expect(LOCKED_VIEWPORT).toContain('viewport-fit=cover');
    expect(html).toContain(`content="${LOCKED_VIEWPORT}"`);
  });

  it('declines pinch and double-tap in CSS while keeping the page scrollable', () => {
    // `manipulation` would still allow a pinch; naming both pans rules it out.
    expect(css).toContain('touch-action: pan-x pan-y');
  });

  it('cancels the iOS gesture events, which ignore the meta tag in a tab', () => {
    const doc = fakeDocument();
    lockZoom(doc);
    for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
      expect(fire(doc, name, {})).toHaveBeenCalled();
    }
  });

  it('registers the gesture listeners as non-passive, or preventDefault is ignored', () => {
    const doc = fakeDocument();
    lockZoom(doc);
    for (const entry of doc.listeners) {
      expect(entry.options).toEqual({ passive: false });
    }
  });

  it('blocks a two-finger drag but leaves one-finger scrolling alone', () => {
    const doc = fakeDocument();
    lockZoom(doc);
    expect(fire(doc, 'touchmove', { touches: [{}, {}] } as never)).toHaveBeenCalled();
    // One finger is a scroll, and scrolling has to keep working.
    expect(fire(doc, 'touchmove', { touches: [{}] } as never)).not.toHaveBeenCalled();
    expect(fire(doc, 'touchmove', {})).not.toHaveBeenCalled();
  });

  it('can be undone, leaving no listener behind', () => {
    const doc = fakeDocument();
    lockZoom(doc)();
    expect(doc.listeners).toHaveLength(0);
  });

  it('is installed at startup', () => {
    expect(main).toContain('lockZoom(document)');
  });
});
