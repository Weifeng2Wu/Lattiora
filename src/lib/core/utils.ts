import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Truncate a string to at most `maxChars` grapheme clusters, appending an
 * ellipsis when it was shortened. Useful for compact chip labels where CSS
 * truncation is not precise enough.
 */
export function truncateToChars(str: string, maxChars: number): string {
	const chars = Array.from(str);
	if (chars.length <= maxChars) return str;
	return `${chars.slice(0, maxChars).join("")}…`;
}

/**
 * Map over `items` with a concurrency limit. Useful for issuing a bounded
 * number of async RPCs in parallel without pulling in a full-blown queue
 * library.
 */
export async function mapLimit<T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let index = 0;

	async function worker(): Promise<void> {
		while (index < items.length) {
			const current = index++;
			results[current] = await fn(items[current]);
		}
	}

	const workers: Promise<void>[] = [];
	const workerCount = Math.max(1, Math.min(concurrency, items.length));
	for (let i = 0; i < workerCount; i++) {
		workers.push(worker());
	}

	await Promise.all(workers);
	return results;
}
