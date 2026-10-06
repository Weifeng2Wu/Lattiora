import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LayoutTranslateItem } from "@/lib/pdf/layout/layout-translate";
import { runLayoutRegionTranslate } from "@/lib/pdf/layout/layout-translate";

const runTranslate = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock("@/lib/translate", () => ({
	runTranslate: (...args: unknown[]) => runTranslate(...args),
}));

vi.mock("@/lib/settings", () => ({
	loadSettings: () => ({
		translate: {
			provider: "googleapi",
			targetLang: "zh-CN",
			sourceLang: "auto",
			providerConfigs: {},
			autoTranslateSelection: false,
			agentId: "",
			modelId: "",
		},
	}),
}));

function item(
	id: string,
	source: string,
	pageIndex: number,
	kind: LayoutTranslateItem["kind"] = "text",
): LayoutTranslateItem {
	return {
		id,
		pageIndex,
		bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.1 },
		kind,
		readingOrder: 0,
		source,
		status: "pending",
	};
}

describe("runLayoutRegionTranslate paragraph chains", () => {
	beforeEach(() => {
		runTranslate.mockReset();
	});

	it("sends a cross-page paragraph as one request and splits the result back", async () => {
		runTranslate.mockResolvedValue("智能体查询环境。随后它更新自己的策略。");
		const items = [
			item("a", "the agent queries the", 0),
			item("b", "environment and then updates its policy.", 1),
		];

		const out = await runLayoutRegionTranslate({ items, onUpdate: () => {} });

		expect(runTranslate).toHaveBeenCalledTimes(1);
		expect(runTranslate.mock.calls[0]?.[0]).toMatchObject({
			text: "the agent queries the environment and then updates its policy.",
		});
		expect(out.map((it) => it.status)).toEqual(["done", "done"]);
		expect(out[0]?.translated).toBe("智能体查询环境。");
		expect(out[1]?.translated).toBe("随后它更新自己的策略。");
	});

	it("skips chains already cached and keeps independent paragraphs separate", async () => {
		runTranslate.mockResolvedValue("[[1]] 第一段。\n\n[[2]] 第二段。");
		const items = [
			{
				...item("cached", "Already translated.", 0),
				status: "done" as const,
				translated: "已翻译。",
			},
			item("a", "First standalone paragraph.", 0),
			item("b", "Second standalone paragraph.", 0),
		];

		const out = await runLayoutRegionTranslate({ items, onUpdate: () => {} });

		expect(runTranslate).toHaveBeenCalledTimes(1);
		const payload = runTranslate.mock.calls[0]?.[0] as { text: string };
		expect(payload.text).toContain("[[1]] First standalone paragraph.");
		expect(payload.text).toContain("[[2]] Second standalone paragraph.");
		expect(payload.text).not.toContain("Already translated.");
		expect(out.map((it) => it.translated)).toEqual([
			"已翻译。",
			"第一段。",
			"第二段。",
		]);
	});

	it("retries unmasked when the engine drops a placeholder", async () => {
		runTranslate
			.mockResolvedValueOnce("参见 网址 获取细节。")
			.mockResolvedValueOnce("参见 https://example.com/x 获取细节。");
		const items = [item("a", "See https://example.com/x for details.", 0)];

		const out = await runLayoutRegionTranslate({ items, onUpdate: () => {} });

		expect(runTranslate).toHaveBeenCalledTimes(2);
		expect(out[0]?.translated).toBe("参见 https://example.com/x 获取细节。");
	});
});
