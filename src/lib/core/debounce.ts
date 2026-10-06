/**
 * Shared trailing-edge debounce. Non-React contexts (module-level store
 * schedulers, sidecar write coalescing) use {@link debounce} directly; React
 * callers should prefer `useDebouncedValue` / `useDebouncedCallback` from
 * `@/hooks/use-debounce`, which thread the latest closure automatically.
 */

export type Debounced<Args extends unknown[]> = ((...args: Args) => void) & {
	/** Drop the pending invocation, if any. */
	cancel(): void;
	/** Run the pending invocation now; no-op when nothing is pending. */
	flush(): void;
};

/**
 * Trailing-edge debounce: every call restarts the timer, and `fn` runs once
 * with the latest arguments after `delayMs` of quiet.
 */
export function debounce<Args extends unknown[]>(
	fn: (...args: Args) => void,
	delayMs: number,
): Debounced<Args> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: Args | null = null;

	const run = () => {
		timer = null;
		const args = lastArgs;
		lastArgs = null;
		if (args) fn(...args);
	};

	const debounced = ((...args: Args) => {
		lastArgs = args;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(run, delayMs);
	}) as Debounced<Args>;

	debounced.cancel = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		lastArgs = null;
	};

	debounced.flush = () => {
		if (timer === null) return;
		clearTimeout(timer);
		run();
	};

	return debounced;
}
