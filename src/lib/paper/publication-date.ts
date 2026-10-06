/**
 * Partial publication dates (`2017`, `2017-06`, `2017-06-12`).
 *
 * Sources hand us loose strings (Zotero translator, Crossref, catalog rows
 * written before dates were normalized), so parsing is lenient: the first
 * standalone 4-digit year wins and a month/day behind a separator must still be
 * a real calendar value. Kept in step with the Host's `parse_publication_date`.
 */

export type PublicationDate = {
	year: number;
	month?: number;
	day?: number;
};

type PaperDateSource = {
	date?: string | null;
	year?: number | null;
};

const DATE_PATTERN =
	/(?:^|\D)(\d{4})(?!\d)(?:([-/. ])(\d{1,2})(?:[-/. ](\d{1,2}))?)?/;

export function parsePublicationDate(
	text: string | null | undefined,
): PublicationDate | null {
	if (!text) return null;
	const match = DATE_PATTERN.exec(text.trim());
	if (!match) return null;
	const year = Number(match[1]);
	if (year < 1000 || year > 2100) return null;
	const month = match[3] ? Number(match[3]) : undefined;
	if (month != null && (month < 1 || month > 12)) return null;
	const day = match[4] ? Number(match[4]) : undefined;
	if (day != null && (day < 1 || day > 31)) return null;
	if (month != null && day != null) {
		const probe = new Date(Date.UTC(year, month - 1, day));
		if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
			return null;
		}
	}
	return { year, month, day };
}

/** Zero-padded `YYYY` / `YYYY-MM` / `YYYY-MM-DD`. */
export function formatPublicationDate(date: PublicationDate): string {
	const year = String(date.year).padStart(4, "0");
	if (date.month == null) return year;
	const month = String(date.month).padStart(2, "0");
	if (date.day == null) return `${year}-${month}`;
	return `${year}-${month}-${String(date.day).padStart(2, "0")}`;
}

/**
 * Display / edit text: canonical date, else the stored year, else nothing.
 */
export function publicationDateText(paper: PaperDateSource): string {
	const parsed = parsePublicationDate(paper.date);
	if (parsed) return formatPublicationDate(parsed);
	if (paper.year != null) return String(paper.year);
	return paper.date?.trim() ?? "";
}

/** `YYYYMMDD` with undisclosed parts as `0` (start of period); null when unknown. */
export function publicationDateSortKey(paper: PaperDateSource): number | null {
	const parsed =
		parsePublicationDate(paper.date) ??
		(paper.year != null ? { year: paper.year } : null);
	if (!parsed) return null;
	return parsed.year * 10000 + (parsed.month ?? 0) * 100 + (parsed.day ?? 0);
}

/** Accepts `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, and ISO timestamps of those. */
export function isPublicationDateInput(text: string): boolean {
	return !text.trim() || parsePublicationDate(text) !== null;
}
