// ============================================================
// MARCOM / Lumi — useDebounce
// ------------------------------------------------------------
// Trails a fast-changing value (a search box) by `delayMs`, so a keystroke
// costs a render but not a request. Every pending update is cancelled by the
// cleanup, which is what makes it a debounce rather than a delay: only the last
// value in a burst is ever committed.
//
// The initial value is returned immediately — a consumer that fetches on the
// debounced value still fetches on mount, without waiting out the first delay.
// ============================================================
import { useState, useEffect } from 'react';

export function useDebounce(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
