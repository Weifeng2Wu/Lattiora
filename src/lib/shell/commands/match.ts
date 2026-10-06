/**
 * Simple subsequence fuzzy score for command palette titles.
 * Higher is better; 0 = no match.
 */
export function fuzzyScore(query: string, text: string): number {
	const q = query.trim().toLowerCase();
	const t = text.toLowerCase();
	if (!q) return 1;
	if (t.includes(q)) {
		// Prefer earlier / contiguous hits
		const idx = t.indexOf(q);
		return 1000 - idx + Math.min(q.length, 50);
	}
	// Subsequence match
	let ti = 0;
	let score = 0;
	let consecutive = 0;
	for (let qi = 0; qi < q.length; qi++) {
		const ch = q[qi];
		let found = false;
		while (ti < t.length) {
			if (t[ti] === ch) {
				found = true;
				consecutive += 1;
				score += 10 + consecutive * 2;
				ti += 1;
				break;
			}
			consecutive = 0;
			ti += 1;
		}
		if (!found) return 0;
	}
	return score;
}

export function filterByFuzzy<T>(
	items: T[],
	query: string,
	getText: (item: T) => string,
): T[] {
	const q = query.trim();
	if (!q) return items;
	return items
		.map((item) => ({ item, score: fuzzyScore(q, getText(item)) }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((x) => x.item);
}
