import { describe, expect, it } from "vitest";
import { type WikiRenameHeadingResult, wikiRenameFailure } from "@/lib/wiki";
import {
	buildWikiHeadingRenameRequest,
	canRenameWikiHeading,
	currentWikiHeadingOrdinal,
	extractWikiHeadingAnchors,
	savedWikiHeadingAt,
	wikiHeadingRenameAffectedPaths,
	wikiHeadingRenameErrorKey,
} from "@/lib/wiki/heading-rename";

describe("saved Wiki heading identity", () => {
	it("matches Host frontmatter, fence, hierarchy, closing marker, and line rules", () => {
		const markdown = [
			"---",
			"title: Example",
			"# Hidden",
			"---",
			"# Root ###",
			"```md",
			"## Hidden in fence",
			"```",
			"### Grandchild",
			"  ## Child  ",
			"#### Leaf#",
		].join("\r\n");

		expect(extractWikiHeadingAnchors(markdown)).toEqual([
			{ text: "Root", path: ["Root"], level: 1, line: 5 },
			{
				text: "Grandchild",
				path: ["Root", "Grandchild"],
				level: 3,
				line: 9,
			},
			{ text: "Child", path: ["Root", "Child"], level: 2, line: 10 },
			{
				text: "Leaf",
				path: ["Root", "Child", "Leaf"],
				level: 4,
				line: 11,
			},
		]);
	});

	it("treats unterminated frontmatter and non-ATX syntax like the Host", () => {
		expect(
			extractWikiHeadingAnchors(
				["---", "# Visible", "####### Not a heading", "#NoSpace"].join("\n"),
			),
		).toEqual([{ text: "Visible", path: ["Visible"], level: 1, line: 2 }]);
	});

	it("maps a Plate heading ordinal only when its saved level still matches", () => {
		const markdown = "# One\nText\n## Two\n";
		expect(savedWikiHeadingAt(markdown, 1, 2)?.path).toEqual(["One", "Two"]);
		expect(savedWikiHeadingAt(markdown, 1, 3)).toBeNull();
	});

	it("resolves the heading that owns the cursor's current section", () => {
		const headings = [[1], [4], [8]];
		expect(currentWikiHeadingOrdinal(headings, [1, 0])).toBe(0);
		expect(currentWikiHeadingOrdinal(headings, [3, 0])).toBe(0);
		expect(currentWikiHeadingOrdinal(headings, [4, 0])).toBe(1);
		expect(currentWikiHeadingOrdinal(headings, [7, 0])).toBe(1);
		expect(currentWikiHeadingOrdinal(headings, [9, 0])).toBe(2);
	});

	it("falls forward to the first heading when the cursor is above it", () => {
		expect(currentWikiHeadingOrdinal([[3], [7]], [0, 0])).toBe(0);
		expect(currentWikiHeadingOrdinal([], [0, 0])).toBeNull();
	});

	it("enables the command only for a clean editable local heading", () => {
		const heading = extractWikiHeadingAnchors("# One\n")[0] ?? null;
		const available = {
			dirty: false,
			filePath: "/vault/notes/One.md",
			hasHandler: true,
			heading,
			readOnly: false,
		};
		expect(canRenameWikiHeading(available)).toBe(true);
		expect(canRenameWikiHeading({ ...available, dirty: true })).toBe(false);
		expect(canRenameWikiHeading({ ...available, filePath: null })).toBe(false);
		expect(canRenameWikiHeading({ ...available, heading: null })).toBe(false);
		expect(canRenameWikiHeading({ ...available, hasHandler: false })).toBe(
			false,
		);
		expect(canRenameWikiHeading({ ...available, readOnly: true })).toBe(false);
	});

	it("builds the Host payload from the saved anchor without changing content", () => {
		const expectedContent = "# Old\n";
		const heading = extractWikiHeadingAnchors(expectedContent)[0];
		expect(heading).toBeDefined();
		if (!heading) throw new Error("expected heading fixture");
		expect(
			buildWikiHeadingRenameRequest(
				"notes/Target.md",
				heading,
				expectedContent,
				"  New  ",
			),
		).toEqual({
			path: "notes/Target.md",
			headingPath: ["Old"],
			headingLine: 1,
			expectedContent,
			newText: "New",
		});
	});
});

describe("heading rename refresh and errors", () => {
	it("reloads the target first and deduplicates rewritten sources", () => {
		const result: WikiRenameHeadingResult = {
			path: "notes/Target.md",
			oldPath: ["Old"],
			newPath: ["New"],
			updatedSources: ["notes/Source.md", "notes/Target.md", "notes/Source.md"],
			rollback: "not-needed",
		};
		expect(wikiHeadingRenameAffectedPaths(result)).toEqual([
			"notes/Target.md",
			"notes/Source.md",
		]);
	});

	it("prioritizes rollback state over the transaction code", () => {
		const manual = Object.assign(new Error("failed"), {
			details: {
				code: "writeFailed",
				rollback: "manual-recovery-required",
			},
		});
		const dirty = Object.assign(new Error("blocked"), {
			details: {
				code: "unsavedEdits",
				rollback: "not-needed",
				paths: ["notes/Source.md", "notes/Target.md"],
			},
		});
		expect(wikiHeadingRenameErrorKey(manual)).toBe("manualRecovery");
		expect(wikiHeadingRenameErrorKey(dirty)).toBe("unsavedEdits");
		expect(wikiRenameFailure(dirty)?.paths).toEqual([
			"notes/Source.md",
			"notes/Target.md",
		]);
		expect(wikiHeadingRenameErrorKey(new Error("unknown"))).toBe("generic");
	});
});
