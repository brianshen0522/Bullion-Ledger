/**
 * Holds the app at 1× on touch devices.
 *
 * Three separate mechanisms, because no single one covers every browser:
 *
 * - `user-scalable=no, maximum-scale=1` in the viewport meta. Honoured by
 *   Chrome and by iOS in a home-screen (standalone) app.
 * - `touch-action: pan-x pan-y` on the document. Allows scrolling in both
 *   directions while declining pinch-zoom and double-tap-to-zoom.
 * - The handlers below. iOS Safari has deliberately ignored `user-scalable=no`
 *   in a normal browser tab since iOS 10, and cancelling its proprietary
 *   `gesture*` events is the only thing that still stops a pinch there.
 *
 * Not included, because they are already handled: focusing an input no longer
 * zooms (every control is 16px under `any-pointer: coarse`), and text is not
 * inflated (`-webkit-text-size-adjust: 100%`).
 */

/** iOS Safari's non-standard pinch events, absent everywhere else. */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

export function lockZoom(
  target: Pick<Document, 'addEventListener' | 'removeEventListener'>,
): () => void {
  const cancel = (event: Event) => event.preventDefault();
  for (const name of GESTURE_EVENTS) {
    target.addEventListener(name, cancel, { passive: false });
  }

  // A two-finger drag is a pinch in progress. The listener must be non-passive
  // or the call to preventDefault is ignored.
  const cancelMultiTouch = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (touches && touches.length > 1) event.preventDefault();
  };
  target.addEventListener('touchmove', cancelMultiTouch, { passive: false });

  return () => {
    for (const name of GESTURE_EVENTS) target.removeEventListener(name, cancel);
    target.removeEventListener('touchmove', cancelMultiTouch);
  };
}

/** The viewport content string the document ships with. */
export const LOCKED_VIEWPORT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
