export function normalizeWikiAnchorText(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

type HeadingEntry = { level: number; text: string };

/** Find the one heading identified by an Obsidian heading-path suffix. */
export function findWikiHeadingIndex(
	headings: HeadingEntry[],
	fragmentPath: string[],
): number {
	const target = fragmentPath.map(normalizeWikiAnchorText);
	if (!target.length) return -1;
	const stack: Array<string | undefined> = [];
	const matches: number[] = [];
	for (const [index, heading] of headings.entries()) {
		stack.length = Math.max(0, heading.level - 1);
		stack[heading.level - 1] = normalizeWikiAnchorText(heading.text);
		const current = stack
			.slice(0, heading.level)
			.filter((part): part is string => part !== undefined);
		const suffix = current.slice(-target.length);
		if (
			suffix.length === target.length &&
			suffix.every((part, pathIndex) => part === target[pathIndex])
		) {
			matches.push(index);
		}
	}
	return matches.length === 1 ? matches[0] : -1;
}

export type WikiBlockIdRange = {
	start: number;
	end: number;
};

/** Locate a valid Obsidian block ID at the end of a rendered text leaf. */
export function findWikiBlockIdRange(text: string): WikiBlockIdRange | null {
	const match = text.match(/(?:^|\s)(\^[\p{L}\p{N}-]+)\s*$/u);
	const marker = match?.[1];
	if (!match || !marker || match.index === undefined) return null;
	const start = match.index + match[0].indexOf(marker);
	return { start, end: start + marker.length };
}

export function hasWikiBlockAnchor(text: string, id: string): boolean {
	const range = findWikiBlockIdRange(text);
	return range ? text.slice(range.start + 1, range.end) === id : false;
}
