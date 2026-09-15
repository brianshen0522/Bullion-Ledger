import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { BASE_VIEWPORT, LOCKED_VIEWPORT, isTouchDevice, lockZoom } from '../src/zoom-lock.js';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8').replace(
  /\s+/g,
  ' ',
);
const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('../src/main.tsx', import.meta.url)), 'utf8');

function fakeView({ coarse, touchPoints }: { coarse: boolean; touchPoints: number }) {
  const listeners: { name: string; fn: EventListener; options?: unknown }[] = [];
  let viewport = BASE_VIEWPORT;
  const meta = {
    getAttribute: () => viewport,
    setAttribute: (_name: string, value: string) => {
      viewport = value;
    },
  };
  return {
    listeners,
    get viewport() {
      return viewport;
    },
    matchMedia: (query: string) => ({ matches: query.includes('coarse') ? coarse : false }),
    navigator: { maxTouchPoints: touchPoints },
    document: {
      querySelector: () => meta,
      addEventListener: vi.fn((name: string, fn: EventListener, options?: unknown) => {
        listeners.push({ name, fn, options });
      }),
      removeEventListener: vi.fn((name: string, fn: EventListener) => {
        const index = listeners.findIndex((l) => l.name === name && l.fn === fn);
        if (index >= 0) listeners.splice(index, 1);
      }),
    },
  };
}

const phone = () => fakeView({ coarse: true, touchPoints: 5 });
const mac = () => fakeView({ coarse: false, touchPoints: 0 });

function fire(view: ReturnType<typeof fakeView>, name: string, event: Partial<Event>) {
  const preventDefault = vi.fn();
  for (const l of view.listeners.filter((entry) => entry.name === name)) {
    l.fn({ preventDefault, ...event } as unknown as Event);
  }
  return preventDefault;
}

/**
 * No single mechanism holds a web app at 1x everywhere: Chrome honours the
 * viewport meta, CSS declines the gestures, and iOS Safari in a browser tab
 * ignores both and needs its proprietary gesture events cancelled.
 */
describe('zoom lock on a touch device', () => {
  it('ships a zoomable viewport and pins it only once touch is detected', () => {
    expect(BASE_VIEWPORT).not.toContain('user-scalable');
    expect(html).toContain(`content="${BASE_VIEWPORT}"`);

    const view = phone();
    lockZoom(view as never);
    expect(view.viewport).toBe(LOCKED_VIEWPORT);
    expect(LOCKED_VIEWPORT).toContain('user-scalable=no');
    expect(LOCKED_VIEWPORT).toContain('maximum-scale=1');
    // Dropping viewport-fit=cover would letterbox a notched phone and strip
    // every safe-area inset the layout depends on.
    expect(LOCKED_VIEWPORT).toContain('viewport-fit=cover');
  });

  it('cancels the iOS gesture events, which ignore the meta tag in a tab', () => {
    const view = phone();
    lockZoom(view as never);
    for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
      expect(fire(view, name, {})).toHaveBeenCalled();
    }
  });

  it('registers the listeners as non-passive, or preventDefault is ignored', () => {
    const view = phone();
    lockZoom(view as never);
    for (const entry of view.listeners) expect(entry.options).toEqual({ passive: false });
  });

  it('blocks a two-finger drag but leaves one-finger scrolling alone', () => {
    const view = phone();
    lockZoom(view as never);
    expect(fire(view, 'touchmove', { touches: [{}, {}] } as never)).toHaveBeenCalled();
    expect(fire(view, 'touchmove', { touches: [{}] } as never)).not.toHaveBeenCalled();
  });

  it('can be undone, restoring the viewport and leaving no listener behind', () => {
    const view = phone();
    lockZoom(view as never)();
    expect(view.listeners).toHaveLength(0);
    expect(view.viewport).toBe(BASE_VIEWPORT);
  });
});

/**
 * macOS Safari sends the same gesture* events for a **trackpad** pinch, so an
 * unconditional lock takes zoom away from the Mac app — where the viewport is
 * large, the pointer is precise, and a zoom is deliberate rather than a
 * mis-touch.
 */
describe('zoom lock leaves a pointer device alone', () => {
  it('detects a touch screen, not merely a device that reports touch points', () => {
    expect(isTouchDevice(phone() as never)).toBe(true);
    expect(isTouchDevice(mac() as never)).toBe(false);
    // A laptop with a touchscreen driven by a mouse reports a fine pointer.
    expect(isTouchDevice(fakeView({ coarse: false, touchPoints: 10 }) as never)).toBe(false);
  });

  it('installs nothing and leaves the viewport zoomable on a Mac', () => {
    const view = mac();
    lockZoom(view as never);
    expect(view.listeners).toHaveLength(0);
    expect(view.viewport).toBe(BASE_VIEWPORT);
    expect(view.document.addEventListener).not.toHaveBeenCalled();
  });

  it('scopes the CSS half of the lock to a coarse pointer too', () => {
    const scoped = css.slice(css.indexOf('@media (any-pointer: coarse)'));
    expect(scoped).toContain('touch-action: pan-x pan-y');
  });

  it('is installed at startup with the window, which carries the pointer media', () => {
    expect(main).toContain('lockZoom(window)');
  });
});
