import { beforeEach, describe, expect, it } from "vitest";

import { selectionsPromptBlock } from "@/lib/agent/selection-prompt";
import {
	clearSelections,
	consumeSelections,
	currentSelections,
	pinActiveSelection,
	publishSelection,
	selectionStore,
	selectionsWithPdfAnchor,
} from "@/lib/agent/selection-store";

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

describe("selection-store PDF anchor", () => {
	beforeEach(() => {
		clearSelections();
	});

	it("preserves page geometry when publishing a PDF selection", () => {
		publishSelection({
			text: "attention is all you need",
			sourcePath: "papers/transformer",
			origin: "pdf",
			page: 3,
			rects: [rect],
			paperAbsPath: "/vault/papers/transformer",
		});
		const active = selectionStore.getState().active;
		expect(active?.page).toBe(3);
		expect(active?.rects).toEqual([rect]);
		expect(active?.paperAbsPath).toBe("/vault/papers/transformer");
		expect(active?.origin).toBe("pdf");
	});

	it("keeps geometry when pinning for Agent chat", () => {
		publishSelection({
			text: "BERT",
			sourcePath: "papers/bert",
			origin: "pdf",
			page: 1,
			rects: [rect],
			paperAbsPath: "/vault/papers/bert",
		});
		expect(pinActiveSelection()).toBe(true);
		const pinned = selectionStore.getState().pinned;
		expect(pinned).toHaveLength(1);
		expect(pinned[0]?.rects).toEqual([rect]);
		expect(pinned[0]?.paperAbsPath).toBe("/vault/papers/bert");
		expect(pinned[0]?.pinned).toBe(true);
	});

	it("selectionsWithPdfAnchor only returns fully anchored PDF selections", () => {
		publishSelection({
			text: "with geometry",
			sourcePath: "papers/a",
			origin: "pdf",
			page: 2,
			rects: [rect],
			paperAbsPath: "/vault/papers/a",
		});
		pinActiveSelection();
		publishSelection({
			text: "markdown only",
			sourcePath: "notes/x.md",
			origin: "markdown",
		});
		pinActiveSelection();
		publishSelection({
			text: "pdf missing rects",
			sourcePath: "papers/b",
			origin: "pdf",
			page: 1,
			paperAbsPath: "/vault/papers/b",
		});
		const all = consumeSelections();
		// Only pinned chips are consumed; the live "pdf missing rects" is dropped.
		expect(all).toHaveLength(2);
		expect(selectionStore.getState().active).toBeNull();
		const anchored = selectionsWithPdfAnchor(all);
		expect(anchored).toHaveLength(1);
		expect(anchored[0]?.text).toBe("with geometry");
		expect(anchored[0]?.page).toBe(2);
		expect(anchored[0]?.paperAbsPath).toBe("/vault/papers/a");
	});

	it("currentSelections ignores the live active selection until pinned", () => {
		publishSelection({
			text: "live only",
			sourcePath: "papers/x",
			origin: "pdf",
			page: 1,
			rects: [rect],
			paperAbsPath: "/vault/papers/x",
		});
		expect(currentSelections()).toEqual([]);
		expect(pinActiveSelection()).toBe(true);
		expect(currentSelections()).toHaveLength(1);
	});

	it("prompt block carries the line span of code-editor selections", () => {
		publishSelection({
			text: "\\section{Introduction}",
			sourcePath: "thesis/main.tex",
			origin: "markdown",
			lineFrom: 7,
			lineTo: 7,
		});
		pinActiveSelection();
		publishSelection({
			text: "line a\nline b\nline c",
			sourcePath: "thesis/main.tex",
			origin: "markdown",
			lineFrom: 12,
			lineTo: 14,
		});
		pinActiveSelection();
		const block = selectionsPromptBlock(consumeSelections());
		expect(block).toContain("from thesis/main.tex (lines 7):");
		expect(block).toContain("from thesis/main.tex (lines 12-14):");
	});
});
