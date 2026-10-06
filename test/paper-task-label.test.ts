import { afterEach, describe, expect, it } from "vitest";
import {
	clearPaperTitleLookup,
	joinTaskDetail,
	paperTaskLabel,
	registerPaperTitleLookup,
} from "@/lib/core/task-label";
import { libraryStore } from "@/lib/paper/library-store";
// Ensure the catalog lookup is wired the same way as the app.
import "@/lib/paper/task-label";

describe("paperTaskLabel", () => {
	afterEach(() => {
		libraryStore.setState({ paperMetaByRelPath: new Map() });
		registerPaperTitleLookup(
			(normalizedPaperRel) =>
				libraryStore.getState().paperMetaByRelPath.get(normalizedPaperRel)
					?.title,
		);
	});

	it("falls back to folder basename when no title lookup is registered", () => {
		clearPaperTitleLookup();
		expect(paperTaskLabel("papers/1706.03762")).toBe("1706.03762");
	});

	it("prefers catalog title over folder id", () => {
		libraryStore.setState({
			paperMetaByRelPath: new Map([
				[
					"papers/1706.03762",
					{
						id: "1706.03762",
						path: "papers/1706.03762",
						title: "Attention Is All You Need",
					} as never,
				],
			]),
		});
		expect(paperTaskLabel("papers/1706.03762")).toBe(
			"Attention Is All You Need",
		);
	});

	it("falls back to folder basename when title is missing", () => {
		expect(paperTaskLabel("papers/1706.03762")).toBe("1706.03762");
	});

	it("ignores papers parent paths", () => {
		expect(paperTaskLabel("papers")).toBeUndefined();
		expect(paperTaskLabel("")).toBeUndefined();
		expect(paperTaskLabel(null)).toBeUndefined();
	});
});

describe("joinTaskDetail", () => {
	it("joins subject and status without duplicating", () => {
		expect(joinTaskDetail("Title", "analyzing")).toBe("Title · analyzing");
		expect(joinTaskDetail("Title", "Title")).toBe("Title");
		expect(joinTaskDetail("Title", "Title · PDF")).toBe("Title · PDF");
		expect(joinTaskDetail(undefined, "Fetching…")).toBe("Fetching…");
	});
});
