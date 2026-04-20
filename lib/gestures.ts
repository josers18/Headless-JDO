/** Light haptic feedback for swipe / gesture affordances (best-effort). */

export function vibrateLight(): void {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(12);
    }
  } catch {
    /* ignore */
  }
}

export function vibrateSuccess(): void {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([10, 40, 14]);
    }
  } catch {
    /* ignore */
  }
}
