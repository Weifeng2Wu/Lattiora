import { beforeEach, describe, expect, it } from "vitest";
import type { PdfVisualSessionTrace } from "@/lib/pdf/agent-trace/types";
import {
	annotationsStore,
	remapTabAnnotations,
	removeTabAnnotations,
	setTabAsks,
	setTabHighlights,
	setTabVisualTraces,
} from "@/lib/pdf/annotations-store";
import type { PdfAskThread } from "@/lib/pdf/ask/types";
import type { PdfHighlight } from "@/lib/pdf/highlight/types";

function highlight(id: string): PdfHighlight {
	return {
		id,
		page: 1,
		color: "yellow",
		quote: "q",
		rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
	} as PdfHighlight;
}

function ask(id: string): PdfAskThread {
	return {
		id,
		paperPath: "papers/a",
		status: "open",
		anchor: {
			page: 1,
			rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
		},
		messages: [],
		createdAt: "t",
		updatedAt: "t",
	} as PdfAskThread;
}

function visual(id: string): PdfVisualSessionTrace {
	return {
		version: 2,
		kind: "visual",
		id,
		paperPath: "papers/a",
		page: 1,
		rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
		comment: "c",
		agent: {
			agentId: "a",
			runtimeSessionId: "r",
			messageId: "m",
			status: "completed",
			index: 1,
		},
		createdAt: "t",
		updatedAt: "t",
	};
}

describe("annotations-store tab lifecycle", () => {
	beforeEach(() => {
		annotationsStore.setState({
			highlightsByTab: {},
			asksByTab: {},
			visualTracesByTab: {},
		});
	});

	it("removeTabAnnotations clears highlights, asks, and visual traces", () => {
		setTabHighlights("tab-a", [highlight("h1")]);
		setTabAsks("tab-a", [ask("ask1")]);
		setTabVisualTraces("tab-a", [visual("v1")]);
		setTabHighlights("tab-b", [highlight("h2")]);
		setTabAsks("tab-b", [ask("ask2")]);
		setTabVisualTraces("tab-b", [visual("v2")]);

		removeTabAnnotations(["tab-a"]);

		const s = annotationsStore.getState();
		expect(s.highlightsByTab["tab-a"]).toBeUndefined();
		expect(s.asksByTab["tab-a"]).toBeUndefined();
		expect(s.visualTracesByTab["tab-a"]).toBeUndefined();
		expect(s.highlightsByTab["tab-b"]).toHaveLength(1);
		expect(s.asksByTab["tab-b"]).toHaveLength(1);
		expect(s.visualTracesByTab["tab-b"]).toHaveLength(1);
	});

	it("remapTabAnnotations re-keys all three collections", () => {
		setTabHighlights("old", [highlight("h1")]);
		setTabAsks("old", [ask("ask1")]);
		setTabVisualTraces("old", [visual("v1")]);

		remapTabAnnotations([{ fromId: "old", toId: "new" }]);

		const s = annotationsStore.getState();
		expect(s.highlightsByTab.old).toBeUndefined();
		expect(s.asksByTab.old).toBeUndefined();
		expect(s.visualTracesByTab.old).toBeUndefined();
		expect(s.highlightsByTab.new?.[0]?.id).toBe("h1");
		expect(s.asksByTab.new?.[0]?.id).toBe("ask1");
		expect(s.visualTracesByTab.new?.[0]?.id).toBe("v1");
	});
});
