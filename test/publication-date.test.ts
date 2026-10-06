import { describe, expect, it } from "vitest";
import {
	buildPaperRow,
	comparePaperRows,
} from "@/components/library/library-row-utils";
import type { PaperLibraryRow } from "@/lib/paper";
import {
	isPublicationDateInput,
	parsePublicationDate,
	publicationDateSortKey,
	publicationDateText,
} from "@/lib/paper/publication-date";

describe("parsePublicationDate", () => {
	it("keeps the precision the source provided", () => {
		expect(parsePublicationDate("2017")).toEqual({ year: 2017 });
		expect(parsePublicationDate("2017-06")).toEqual({ year: 2017, month: 6 });
		expect(parsePublicationDate(" 2017-06-12 ")).toEqual({
			year: 2017,
			month: 6,
			day: 12,
		});
	});

	it("reads ISO timestamps and separated variants", () => {
		expect(parsePublicationDate("2017-06-12T00:00:00Z")).toEqual({
			year: 2017,
			month: 6,
			day: 12,
		});
		expect(parsePublicationDate("2017/6/2")).toEqual({
			year: 2017,
			month: 6,
			day: 2,
		});
		// Prose dates still yield the year (Zotero hands us these verbatim).
		expect(parsePublicationDate("Spring 2017")).toEqual({ year: 2017 });
	});

	it("rejects impossible or missing values", () => {
		expect(parsePublicationDate(null)).toBeNull();
		expect(parsePublicationDate("")).toBeNull();
		expect(parsePublicationDate("n.d.")).toBeNull();
		expect(parsePublicationDate("12000")).toBeNull();
		expect(parsePublicationDate("2017-13")).toBeNull();
		expect(parsePublicationDate("2017-02-30")).toBeNull();
	});
});

describe("publicationDateText", () => {
	it("prefers the date, falls back to the year", () => {
		expect(publicationDateText({ date: "2017-6-2", year: 2017 })).toBe(
			"2017-06-02",
		);
		expect(publicationDateText({ date: null, year: 2017 })).toBe("2017");
		expect(publicationDateText({ date: "Spring 2017", year: 2017 })).toBe(
			"2017",
		);
		expect(publicationDateText({ date: null, year: null })).toBe("");
	});
});

describe("isPublicationDateInput", () => {
	it("allows empty and partial dates, rejects junk", () => {
		expect(isPublicationDateInput("")).toBe(true);
		expect(isPublicationDateInput("2019-7")).toBe(true);
		expect(isPublicationDateInput("n.d.")).toBe(false);
	});
});

describe("publicationDateSortKey", () => {
	it("pads undisclosed parts so ordering stays chronological", () => {
		expect(publicationDateSortKey({ date: "2017-06-12" })).toBe(20170612);
		expect(publicationDateSortKey({ date: "2017-06" })).toBe(20170600);
		expect(publicationDateSortKey({ date: null, year: 2017 })).toBe(20170000);
		expect(publicationDateSortKey({ date: null, year: null })).toBeNull();
	});
});

describe("library date sort", () => {
	const row = (title: string, date: string | null, year: number | null) =>
		buildPaperRow({
			id: title,
			path: `papers/${title}`,
			title,
			authors: [],
			tags: [],
			status: "completed",
			added_at: "2020-01-01T00:00:00Z",
			updated_at: "2020-01-01T00:00:00Z",
			date,
			year,
			has_pdf: undefined,
		} as PaperLibraryRow);

	it("sorts newest first; unknown dates follow the numeric-column rule", () => {
		const rows = [
			row("old", "2024-01-05", 2024),
			row("undated", null, null),
			row("new", "2024-06-12", 2024),
		];
		rows.sort((a, b) => comparePaperRows(a, b, "date", "desc"));
		expect(rows.map((r) => r.paper.title)).toEqual(["new", "old", "undated"]);

		// Undated rows key on -Infinity, like a missing citation count.
		rows.sort((a, b) => comparePaperRows(a, b, "date", "asc"));
		expect(rows.map((r) => r.paper.title)).toEqual(["undated", "old", "new"]);
	});

	it("orders year-only rows ahead of that year's dated rows", () => {
		const rows = [row("june", "2024-06", 2024), row("year-only", null, 2024)];
		rows.sort((a, b) => comparePaperRows(a, b, "date", "asc"));
		expect(rows.map((r) => r.paper.title)).toEqual(["year-only", "june"]);
	});
});

describe("library search index", () => {
	it("includes identifiers, path, DOI, authors, publication, and tags", () => {
		const row = buildPaperRow({
			id: "10_3389_fpls_2025_1611992",
			path: "papers/10_3389_fpls_2025_1611992",
			title:
				"Foundation models in plant molecular biology: advances, challenges, and future directions",
			authors: ["Feng Xu", "Tianhao Wu"],
			tags: [{ name: "Plant FM" }],
			doi: "10.3389/fpls.2025.1611992",
			publication: "Frontiers in Plant Science",
			status: "completed",
			added_at: "2026-09-23T07:32:44.036Z",
			updated_at: "2026-09-25T00:37:10.966Z",
			has_pdf: true,
		} as PaperLibraryRow);

		for (const query of [
			"10_3389_fpls_2025_1611992",
			"10.3389/fpls.2025.1611992",
			"feng xu",
			"frontiers in plant science",
			"plant fm",
			"papers/10_3389_fpls_2025_1611992",
		]) {
			expect(row.searchText).toContain(query);
		}
	});
});
