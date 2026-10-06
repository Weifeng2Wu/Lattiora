import { describe, expect, it } from "vitest";

import { buildMarksIndex } from "@/components/viewer/pdf/marks-index";
import type { PdfVisualSessionTrace } from "@/lib/pdf/agent-trace";

function visualTrace(opts: {
	id: string;
	page: number;
	y: number;
	comment?: string;
	hasAgent?: boolean;
}): PdfVisualSessionTrace {
	return {
		version: 2,
		kind: "visual",
		id: opts.id,
		paperPath: "papers/test",
		page: opts.page,
		rects: [{ x: 0.1, y: opts.y, width: 0.2, height: 0.05 }],
		comment: opts.comment ?? "region note",
		image: { data: "base64", mimeType: "image/png" },
		...(opts.hasAgent
			? {
					agent: {
						agentId: "test-agent",
						runtimeSessionId: "rt-1",
						messageId: "msg-1",
						status: "completed" as const,
						messages: [
							{
								id: "m1",
								role: "user" as const,
								content: "explain",
								createdAt: "2026-09-02T00:00:00Z",
							},
						],
					},
				}
			: {}),
		createdAt: "2026-09-02T00:00:00Z",
		updatedAt: "2026-09-02T00:00:00Z",
	};
}

describe("buildMarksIndex", () => {
	it("keeps an uncommented crop reachable after the temporary editor closes", () => {
		const index = buildMarksIndex({
			highlights: [],
			highlightAnchors: new Map(),
			askPinAnchors: [],
			visualTraces: [visualTrace({ id: "crop", page: 1, y: 0.4, comment: "" })],
			pageTextMap: new Map(),
			paperTitle: undefined,
		});
		expect(index.commentsByPage.get(1)).toEqual([
			expect.objectContaining({ id: "crop", kind: "visual", comment: "" }),
		]);
	});

	it("omits messages for visual comments without an agent conversation", () => {
		const index = buildMarksIndex({
			highlights: [],
			highlightAnchors: new Map(),
			askPinAnchors: [],
			visualTraces: [visualTrace({ id: "v1", page: 1, y: 0.4 })],
			pageTextMap: new Map(),
			paperTitle: undefined,
		});
		const comments = index.commentsByPage.get(1) ?? [];
		expect(comments).toHaveLength(1);
		expect(comments[0]?.kind).toBe("visual");
		expect(comments[0]?.messages).toBeUndefined();
	});

	it("includes conversation messages for visual comments with an agent conversation", () => {
		const index = buildMarksIndex({
			highlights: [],
			highlightAnchors: new Map(),
			askPinAnchors: [],
			visualTraces: [
				visualTrace({ id: "v1", page: 1, y: 0.4, hasAgent: true }),
			],
			pageTextMap: new Map(),
			paperTitle: undefined,
		});
		const comments = index.commentsByPage.get(1) ?? [];
		expect(comments).toHaveLength(1);
		expect(comments[0]?.kind).toBe("visual");
		expect(comments[0]?.messages).toHaveLength(1);
		expect(comments[0]?.messages?.[0]?.role).toBe("user");
		expect(comments[0]?.messages?.[0]?.content).toBe("explain");
	});

	it("skips the comment card for agent-only marks without a comment", () => {
		const index = buildMarksIndex({
			highlights: [],
			highlightAnchors: new Map(),
			askPinAnchors: [],
			visualTraces: [
				visualTrace({
					id: "v1",
					page: 1,
					y: 0.4,
					comment: "",
					hasAgent: true,
				}),
			],
			pageTextMap: new Map(),
			paperTitle: undefined,
		});
		expect(index.commentsByPage.get(1) ?? []).toHaveLength(0);
		const pins = index.pinsByPage.get(1) ?? [];
		expect(pins).toHaveLength(1);
		expect(pins[0]?.kind).toBe("visual");
	});

	it("keeps a gutter pin for visual marks that have an agent conversation", () => {
		const index = buildMarksIndex({
			highlights: [],
			highlightAnchors: new Map(),
			askPinAnchors: [],
			visualTraces: [
				visualTrace({ id: "v1", page: 1, y: 0.4, hasAgent: true }),
			],
			pageTextMap: new Map(),
			paperTitle: undefined,
		});
		const pins = index.pinsByPage.get(1) ?? [];
		expect(pins).toHaveLength(1);
		expect(pins[0]?.kind).toBe("visual");
	});
});
