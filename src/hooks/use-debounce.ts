import { useEffect, useMemo, useRef, useState } from "react";
import { type Debounced, debounce } from "@/lib/core/debounce";

/**
 * Debounce an imperative callback (search commits, autosave scheduling).
 *
 * The returned function is stable across renders and always invokes the
 * latest closure. The caller owns the lifecycle: nothing is cancelled
 * automatically, so wire `cancel()` / `flush()` into the effect cleanups or
 * unmount flushes the debounced action needs (a pending autosave must flush
 * on file switch, a pending search must drop on unmount, …).
 */
export function useDebouncedCallback<Args extends unknown[]>(
	fn: (...args: Args) => void,
	delayMs: number,
): Debounced<Args> {
	const fnRef = useRef(fn);
	fnRef.current = fn;
	return useMemo(
		() => debounce((...args: Args) => fnRef.current(...args), delayMs),
		[delayMs],
	);
}

/**
 * Debounce a fast-changing value (keystrokes, scroll position): returns the
 * value as it was `delayMs` of quiet ago. Pending updates are dropped on
 * unmount.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	const apply = useDebouncedCallback(setDebounced, delayMs);
	useEffect(() => {
		apply(value);
		return () => apply.cancel();
	}, [value, apply]);
	return debounced;
}
