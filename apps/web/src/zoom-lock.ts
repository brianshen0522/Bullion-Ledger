/**
 * Holds the app at 1× on touch devices — and only on touch devices.
 *
 * Three mechanisms, because no single one covers every browser:
 *
 * - `user-scalable=no, maximum-scale=1` on the viewport meta. Honoured by
 *   Chrome and by iOS once the app is installed to the home screen.
 * - `touch-action: pan-x pan-y` on the document (see index.css). Scrolls in
 *   both directions while declining pinch and double-tap-to-zoom.
 * - The gesture handlers below. iOS Safari has ignored `user-scalable=no` in a
 *   normal browser tab since iOS 10, and cancelling its proprietary `gesture*`
 *   events is the only thing that still stops a pinch there.
 *
 * All three are gated on the pointer being coarse. macOS Safari fires those
 * same `gesture*` events for a **trackpad** pinch, so applying this everywhere
 * takes zoom away from the Mac app — where the viewport is large, the input is
 * precise, and zooming is a deliberate act rather than a fat-finger accident.
 *
 * Not included, because they are handled already: focusing an input does not
 * zoom (every control is 16px under `any-pointer: coarse`) and text is not
 * inflated (`-webkit-text-size-adjust: 100%`).
 */

/** iOS Safari's non-standard pinch events — also sent by macOS for a trackpad. */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/** What the document ships with: zoomable, and still covering the notch. */
export const BASE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';

/** What a touch device gets instead. */
export const LOCKED_VIEWPORT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

/**
 * A touch screen, as opposed to a trackpad or mouse. Both signals are checked:
 * `maxTouchPoints` alone reports true for a Windows laptop with a touchscreen
 * that is mainly driven by a mouse.
 */
export function isTouchDevice(view: Pick<Window, 'matchMedia' | 'navigator'>): boolean {
  const coarse = view.matchMedia?.('(any-pointer: coarse)').matches ?? false;
  return coarse && (view.navigator?.maxTouchPoints ?? 0) > 0;
}

export function lockZoom(view: Window & typeof globalThis): () => void {
  if (!isTouchDevice(view)) return () => {};

  const meta = view.document.querySelector('meta[name="viewport"]');
  const previousViewport = meta?.getAttribute('content') ?? null;
  meta?.setAttribute('content', LOCKED_VIEWPORT);

  const cancel = (event: Event) => event.preventDefault();
  for (const name of GESTURE_EVENTS) {
    view.document.addEventListener(name, cancel, { passive: false });
  }

  // A two-finger drag is a pinch in progress. The listener must be non-passive
  // or the call to preventDefault is ignored.
  const cancelMultiTouch = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (touches && touches.length > 1) event.preventDefault();
  };
  view.document.addEventListener('touchmove', cancelMultiTouch, { passive: false });

  return () => {
    for (const name of GESTURE_EVENTS) view.document.removeEventListener(name, cancel);
    view.document.removeEventListener('touchmove', cancelMultiTouch);
    if (previousViewport !== null) meta?.setAttribute('content', previousViewport);
  };
}
