/**
 * useDebouncedValue — return a value that updates only after `delayMs`
 * has passed without further changes.
 *
 * Use when a fast-changing source value (typed input, dragging slider)
 * needs to drive an expensive downstream consumer (network request,
 * heavy compute). Set on the raw value as input; the returned value
 * lags by `delayMs` but settles to the latest source value once
 * keystrokes stop.
 *
 * Why this exists:
 *   - Theme #5's server-side filters bake their state into a TanStack
 *     Query queryKey. A user typing into a search input would
 *     otherwise fire one network request per keystroke. Piping the
 *     input through this hook before it reaches the queryKey turns
 *     "fire on every keystroke" into "fire once after the user pauses
 *     for `delayMs`." See PR #46 / doc 29 Part 4.
 *
 * Usage:
 *   const [search, setSearch] = useState("");
 *   const debouncedSearch = useDebouncedValue(search, 300);
 *   // queryKey uses debouncedSearch; input uses search
 *
 * Why not import a library:
 *   - The implementation is ~10 LOC of standard React.
 *   - We don't need cancellation, leading/trailing toggles, or
 *     comparator overrides. lodash/debounce would be 4 KB of vendor
 *     weight for behavior we can write in-house.
 *
 * Trade-offs:
 *   - The returned value is always at least one render behind the
 *     source. If the consumer needs to react to the LATEST value
 *     instantly (e.g. echoing the input back to the user), keep the
 *     source state too — the input element's `value` should bind to
 *     `search`, not `debouncedSearch`.
 *   - First render returns the initial value immediately (no
 *     setTimeout fires on mount). Subsequent changes use the
 *     `delayMs` window.
 */

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    // Cleanup cancels the pending update if `value` changes again
    // before `delayMs` elapses. That's the whole trick — every
    // keystroke restarts the timer, and only the last one survives.
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debouncedValue;
}
