const NATURAL_NAME_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

export function compareNaturalName(a: string, b: string): number {
	return NATURAL_NAME_COLLATOR.compare(a, b);
}
