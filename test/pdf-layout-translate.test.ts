import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	expandLayoutTranslateBbox,
	fontSizeForLayoutTranslateBox,
} from "@/components/viewer/pdf/layers/layout-translate-overlay";
import {
	applyLayoutTranslateSidecar,
	groupLayoutTranslateItemsByPage,
	hasPendingLayoutTranslateItems,
	LAYOUT_TRANSLATE_WRITE_DEBOUNCE_MS,
	type LayoutTranslateCacheKey,
	type LayoutTranslateItem,
	type LayoutTranslateItemStatus,
	layoutRegionSourceText,
	listTranslatableLayoutRegions,
	parseLayoutTranslateSidecar,
	persistLayoutTranslateSidecarBestEffort,
	toLayoutTranslateItems,
	translateServiceKey,
} from "@/lib/pdf/layout/layout-translate";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";
import { DEFAULT_TRANSLATE_SETTINGS } from "@/lib/translate/defaults";

vi.mock("@/lib/vault", () => ({
	joinVaultPath: (parent: string, name: string) => `${parent}/${name}`,
	readVaultFile: vi.fn(),
	writeVaultFile: vi.fn(),
}));

function region(
	partial: Partial<PdfLayoutRegion> &
		Pick<PdfLayoutRegion, "id" | "kind" | "pageIndex">,
): PdfLayoutRegion {
	return {
		label: partial.kind,
		score: 0.9,
		readingOrder: 0,
		rect: { x: 0, y: 0, w: 100, h: 20 },
		bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
		...partial,
	};
}

describe("listTranslatableLayoutRegions", () => {
	it("keeps body text / abstract / header with extractable text in reading order", () => {
		const list = listTranslatableLayoutRegions([
			region({
				id: "img",
				kind: "image",
				pageIndex: 0,
				text: "should skip",
			}),
			region({
				id: "t2",
				kind: "text",
				pageIndex: 0,
				readingOrder: 2,
				bbox: { x: 0.1, y: 0.4, w: 0.5, h: 0.1 },
				text: "second paragraph",
			}),
			region({
				id: "abs",
				kind: "abstract",
				pageIndex: 0,
				readingOrder: 0,
				bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.15 },
				text: "This is the abstract.",
			}),
			region({
				id: "low",
				kind: "text",
				pageIndex: 0,
				score: 0.1,
				text: "below threshold",
			}),
			region({
				id: "empty",
				kind: "text",
				pageIndex: 0,
				readingOrder: 1,
			}),
		]);
		expect(list.map((r) => r.id)).toEqual(["abs", "t2"]);
		expect(list[0]?.source).toBe("This is the abstract.");
	});

	it("prefers text over title for source", () => {
		expect(
			layoutRegionSourceText(
				region({
					id: "h",
					kind: "header",
					pageIndex: 0,
					title: "from title",
					text: "from text",
				}),
			),
		).toBe("from text");
	});

	it("marks items pending for a new job", () => {
		const items = toLayoutTranslateItems(
			listTranslatableLayoutRegions([
				region({
					id: "a",
					kind: "text",
					pageIndex: 0,
					text: "hello",
				}),
			]),
		);
		expect(items).toHaveLength(1);
		expect(items[0]?.status).toBe("pending");
	});

	it("skips algorithm boxes and text inside them", () => {
		const list = listTranslatableLayoutRegions([
			region({
				id: "alg",
				kind: "algorithm",
				pageIndex: 0,
				bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.3 },
				text: "1: procedure FOO",
			}),
			region({
				id: "inside",
				kind: "text",
				pageIndex: 0,
				bbox: { x: 0.15, y: 0.25, w: 0.6, h: 0.1 },
				text: "line inside algorithm",
			}),
			region({
				id: "title",
				kind: "header",
				pageIndex: 0,
				bbox: { x: 0.1, y: 0.15, w: 0.4, h: 0.03 },
				text: "Algorithm 1 Main loop",
			}),
			region({
				id: "body",
				kind: "text",
				pageIndex: 0,
				bbox: { x: 0.1, y: 0.6, w: 0.8, h: 0.1 },
				text: "normal paragraph",
			}),
		]);
		expect(list.map((r) => r.id)).toEqual(["body"]);
	});

	it("includes figure and table captions (figure_title)", () => {
		const list = listTranslatableLayoutRegions([
			region({
				id: "fig",
				kind: "figure_title",
				pageIndex: 0,
				readingOrder: 1,
				bbox: { x: 0.1, y: 0.5, w: 0.8, h: 0.04 },
				title: "Figure 1: Overview of the system.",
			}),
			region({
				id: "tab",
				kind: "figure_title",
				pageIndex: 0,
				readingOrder: 2,
				bbox: { x: 0.1, y: 0.7, w: 0.8, h: 0.04 },
				text: "Table 2: Ablation study results.",
				captionRole: "table_main",
			}),
		]);
		expect(list.map((r) => r.id)).toEqual(["fig", "tab"]);
		expect(list[0]?.source).toContain("Figure 1");
		expect(list[1]?.source).toContain("Table 2");
	});

	it("skips reference entries and the References heading", () => {
		const list = listTranslatableLayoutRegions([
			region({
				id: "ref1",
				kind: "text",
				label: "reference",
				pageIndex: 0,
				bbox: { x: 0.1, y: 0.3, w: 0.8, h: 0.05 },
				text: "[1] Smith et al. A paper. 2024.",
			}),
			region({
				id: "refc",
				kind: "text",
				label: "reference_content",
				pageIndex: 0,
				bbox: { x: 0.1, y: 0.36, w: 0.8, h: 0.08 },
				text: "Long bibliography line with doi.",
			}),
			region({
				id: "reftitle",
				kind: "header",
				pageIndex: 0,
				bbox: { x: 0.1, y: 0.25, w: 0.3, h: 0.03 },
				text: "References",
			}),
			region({
				id: "body",
				kind: "text",
				label: "text",
				pageIndex: 0,
				bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
				text: "Introduction body.",
			}),
		]);
		expect(list.map((r) => r.id)).toEqual(["body"]);
	});

	it("skips aside_text side-margin regions", () => {
		const list = listTranslatableLayoutRegions([
			region({
				id: "aside",
				kind: "text",
				label: "aside_text",
				pageIndex: 0,
				bbox: { x: 0.01, y: 0.05, w: 0.04, h: 0.9 },
				text: "arXiv:2608.00881v1 [cs.LG] 1 Aug 2026",
			}),
			region({
				id: "body",
				kind: "text",
				label: "text",
				pageIndex: 0,
				bbox: { x: 0.12, y: 0.2, w: 0.7, h: 0.15 },
				text: "Normal paragraph on the page.",
			}),
		]);
		expect(list.map((r) => r.id)).toEqual(["body"]);
	});
});

describe("fontSizeForLayoutTranslateBox", () => {
	it("scales roughly with box height for body paragraphs", () => {
		const pageW = 800;
		const pageH = 1100;
		const body = fontSizeForLayoutTranslateBox(
			{ x: 0.1, y: 0.2, w: 0.8, h: 0.2 },
			pageW,
			pageH,
			"A".repeat(600),
		);
		const header = fontSizeForLayoutTranslateBox(
			{ x: 0.1, y: 0.1, w: 0.5, h: 0.03 },
			pageW,
			pageH,
			"Introduction",
		);
		expect(body).toBeGreaterThanOrEqual(7);
		expect(body).toBeLessThanOrEqual(20);
		expect(header).toBeGreaterThanOrEqual(7);
		expect(header).toBeGreaterThan(body * 0.4);
	});

	it("grows modestly when Chinese translation is denser than English source", () => {
		const bbox = { x: 0.1, y: 0.2, w: 0.8, h: 0.25 };
		const pageW = 800;
		const pageH = 1100;
		const en = "The quick brown fox jumps over the lazy dog. ".repeat(12);
		const zh = "大型语言模型代理越来越多地通过状态工具进行操作。".repeat(4);
		const paperLike = fontSizeForLayoutTranslateBox(bbox, pageW, pageH, en, en);
		const withZh = fontSizeForLayoutTranslateBox(bbox, pageW, pageH, en, zh);
		// Denser CN may use a larger size to fill the same box, but not unbounded.
		expect(withZh).toBeGreaterThanOrEqual(paperLike * 0.95);
		expect(withZh).toBeLessThanOrEqual(paperLike * 1.25 + 0.5);
	});
});

describe("expandLayoutTranslateBbox", () => {
	function item(kind: LayoutTranslateItem["kind"]): LayoutTranslateItem {
		return {
			id: "title",
			pageIndex: 0,
			bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.03 },
			kind,
			readingOrder: 0,
			source: "A long section title",
			translated: "这是一个用于验证安全扩框行为的更长章节标题",
			status: "done",
		};
	}

	it("borrows right-side whitespace for a heading but stops before a blocker", () => {
		const expanded = expandLayoutTranslateBbox(item("header"), [
			region({
				id: "next-column",
				kind: "text",
				pageIndex: 0,
				bbox: { x: 0.42, y: 0.1, w: 0.3, h: 0.1 },
			}),
		]);
		expect(expanded.w).toBeGreaterThan(0.2);
		expect(expanded.x + expanded.w).toBeLessThan(0.42);
	});

	it("does not expand a long body paragraph into adjacent content", () => {
		const body = { ...item("text"), source: "word ".repeat(100) };
		expect(expandLayoutTranslateBbox(body)).toEqual(body.bbox);
	});
});

describe("groupLayoutTranslateItemsByPage", () => {
	function translateItem(
		id: string,
		pageIndex: number,
		status: LayoutTranslateItemStatus = "pending",
	): LayoutTranslateItem {
		return {
			id,
			pageIndex,
			bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
			kind: "text",
			readingOrder: 0,
			source: `source ${id}`,
			status,
		};
	}

	it("buckets items by page, keeping job order within a page", () => {
		const grouped = groupLayoutTranslateItemsByPage([
			translateItem("b", 1),
			translateItem("a", 0),
			translateItem("c", 1),
		]);
		expect([...grouped.keys()]).toEqual([1, 0]);
		expect(grouped.get(0)?.map((it) => it.id)).toEqual(["a"]);
		expect(grouped.get(1)?.map((it) => it.id)).toEqual(["b", "c"]);
	});

	it("reuses previous bucket identity for unchanged pages", () => {
		const before = groupLayoutTranslateItemsByPage([
			{ ...translateItem("a", 0, "done"), translated: "甲" },
			translateItem("b", 1, "running"),
		]);
		// Fresh item objects (streaming publish copies everything); only page 1 advanced.
		const after = groupLayoutTranslateItemsByPage(
			[
				{ ...translateItem("a", 0, "done"), translated: "甲" },
				{ ...translateItem("b", 1, "done"), translated: "乙" },
			],
			before,
		);
		expect(after.get(0)).toBe(before.get(0));
		expect(after.get(1)).not.toBe(before.get(1));
		expect(after.get(1)?.map((it) => it.status)).toEqual(["done"]);
	});
});

describe("layout translate sidecar cache", () => {
	const key: LayoutTranslateCacheKey = {
		providerId: "googleapi",
		sourceLang: "auto",
		targetLang: "zh-CN",
		serviceKey: "googleapi",
	};

	function item(id: string, source = `source ${id}`): LayoutTranslateItem {
		return {
			id,
			pageIndex: 0,
			bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
			kind: "text",
			readingOrder: 0,
			source,
			status: "pending",
		};
	}

	it("applies cached translations only when key and source text match", () => {
		const sidecar = parseLayoutTranslateSidecar(
			{
				schemaVersion: 1,
				source: {
					mode: "pdf-layout-translate",
					generatedAt: "2026-08-10T00:00:00.000Z",
					providerId: "googleapi",
					sourceLang: "auto",
					targetLang: "zh-CN",
					serviceKey: "googleapi",
				},
				items: [
					{
						id: "a",
						pageIndex: 0,
						bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
						kind: "text",
						readingOrder: 0,
						source: "source a",
						translated: "甲",
					},
					{
						id: "b",
						pageIndex: 0,
						bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.05 },
						kind: "text",
						readingOrder: 1,
						source: "old source",
						translated: "乙",
					},
				],
			},
			key,
		);
		const applied = applyLayoutTranslateSidecar(
			[item("a"), item("b")],
			sidecar,
		);

		expect(applied[0]).toMatchObject({
			status: "done",
			translated: "甲",
		});
		expect(applied[1]?.status).toBe("pending");
		expect(applied[1]?.translated).toBeUndefined();
		expect(hasPendingLayoutTranslateItems(applied)).toBe(true);
	});

	it("rejects caches for a different target language", () => {
		const sidecar = parseLayoutTranslateSidecar(
			{
				schemaVersion: 1,
				source: {
					mode: "pdf-layout-translate",
					generatedAt: "2026-08-10T00:00:00.000Z",
					providerId: "googleapi",
					sourceLang: "auto",
					targetLang: "en",
					serviceKey: "googleapi",
				},
				items: [
					{
						id: "a",
						pageIndex: 0,
						bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
						kind: "text",
						readingOrder: 0,
						source: "source a",
						translated: "A",
					},
				],
			},
			key,
		);

		expect(sidecar).toBeNull();
		expect(
			hasPendingLayoutTranslateItems([
				{ ...item("a"), translated: "甲", status: "done" },
			]),
		).toBe(false);
	});
});

describe("persistLayoutTranslateSidecarBestEffort debounce", () => {
	const key: LayoutTranslateCacheKey = {
		providerId: "googleapi",
		sourceLang: "auto",
		targetLang: "zh-CN",
		serviceKey: "googleapi",
	};
	const doneItem: LayoutTranslateItem = {
		id: "a",
		pageIndex: 0,
		bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
		kind: "text",
		readingOrder: 0,
		source: "source a",
		status: "done",
		translated: "甲",
	};

	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("coalesces rapid per-block writes into a single write", async () => {
		const vault = await import("@/lib/vault");
		vi.mocked(vault.writeVaultFile).mockReset();

		persistLayoutTranslateSidecarBestEffort("/vault/paper", key, [doneItem]);
		persistLayoutTranslateSidecarBestEffort("/vault/paper", key, [doneItem]);
		persistLayoutTranslateSidecarBestEffort("/vault/paper", key, [doneItem]);
		expect(vault.writeVaultFile).not.toHaveBeenCalled();

		vi.advanceTimersByTime(LAYOUT_TRANSLATE_WRITE_DEBOUNCE_MS + 1);
		expect(vault.writeVaultFile).toHaveBeenCalledTimes(1);
	});

	it("keeps a separate debounce timer per paper", async () => {
		const vault = await import("@/lib/vault");
		vi.mocked(vault.writeVaultFile).mockReset();

		persistLayoutTranslateSidecarBestEffort("/vault/paper-a", key, [doneItem]);
		persistLayoutTranslateSidecarBestEffort("/vault/paper-b", key, [doneItem]);
		vi.advanceTimersByTime(LAYOUT_TRANSLATE_WRITE_DEBOUNCE_MS + 1);
		expect(vault.writeVaultFile).toHaveBeenCalledTimes(2);
	});
});

describe("translateServiceKey custom prompt fingerprint", () => {
	const base = {
		...DEFAULT_TRANSLATE_SETTINGS,
		provider: "googleapi" as const,
	};

	it("empty prompt keeps the prompt-less key byte-identical", () => {
		expect(translateServiceKey({ ...base, customPrompt: "" })).toBe(
			"googleapi",
		);
		expect(translateServiceKey({ ...base, customPrompt: "   " })).toBe(
			"googleapi",
		);
	});

	it("non-empty prompt appends a stable fingerprint", () => {
		const a = translateServiceKey({ ...base, customPrompt: "Be terse." });
		const b = translateServiceKey({ ...base, customPrompt: "Be terse." });
		const c = translateServiceKey({ ...base, customPrompt: "Be verbose." });
		expect(a).not.toBe("googleapi");
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});

	it("works for the agent provider too", () => {
		const agentBase = {
			...DEFAULT_TRANSLATE_SETTINGS,
			provider: "agent" as const,
			agentId: "claude-1",
			modelId: "",
		};
		expect(translateServiceKey({ ...agentBase, customPrompt: "" })).toBe(
			"agent:claude-1:default",
		);
		expect(
			translateServiceKey({ ...agentBase, customPrompt: "Be terse." }),
		).not.toBe("agent:claude-1:default");
	});
});
