import { describe, expect, it } from "vitest";
import {
	classifyStreamChunk,
	promoteOrphanThoughtToText,
	ThinkTagParser,
} from "@/lib/agent/stream-parse";

describe("ThinkTagParser", () => {
	it("splits think block from following answer in one chunk", () => {
		const p = new ThinkTagParser();
		const slices = p.push(
			"<think>step one\nstep two</think>\n\n## Final answer\n42",
		);
		expect(slices).toEqual([
			{ kind: "reasoning", text: "step one\nstep two" },
			{ kind: "text", text: "\n\n## Final answer\n42" },
		]);
	});

	it("handles open/close tags split across chunks", () => {
		const p = new ThinkTagParser();
		expect(p.push("<thi")).toEqual([]);
		expect(p.push("nk>hidden")).toEqual([
			{ kind: "reasoning", text: "hidden" },
		]);
		expect(p.push(" mind</thi")).toEqual([
			{ kind: "reasoning", text: " mind" },
		]);
		expect(p.push("nk>visible")).toEqual([{ kind: "text", text: "visible" }]);
	});

	it("treats plain message as text", () => {
		const p = new ThinkTagParser();
		expect(p.push("hello world")).toEqual([
			{ kind: "text", text: "hello world" },
		]);
	});

	it("supports thinking and reasoning tag aliases", () => {
		const p = new ThinkTagParser();
		const a = p.push("<thinking>a</thinking>b");
		expect(a).toEqual([
			{ kind: "reasoning", text: "a" },
			{ kind: "text", text: "b" },
		]);
		p.reset();
		const b = p.push("<reasoning>x</reasoning>y");
		expect(b).toEqual([
			{ kind: "reasoning", text: "x" },
			{ kind: "text", text: "y" },
		]);
	});
});

describe("classifyStreamChunk", () => {
	it("maps thought kind to reasoning when no tags", () => {
		const p = new ThinkTagParser();
		expect(classifyStreamChunk("thought", "pondering", p)).toEqual([
			{ kind: "reasoning", text: "pondering" },
		]);
	});

	it("splits think tags on message kind", () => {
		const p = new ThinkTagParser();
		expect(classifyStreamChunk("message", "<think>t</think>answer", p)).toEqual(
			[
				{ kind: "reasoning", text: "t" },
				{ kind: "text", text: "answer" },
			],
		);
	});
});

describe("promoteOrphanThoughtToText", () => {
	it("promotes sole reasoning part when no text", () => {
		const parts = [
			{ type: "reasoning", id: "r1", text: "This is actually the answer." },
		];
		const out = promoteOrphanThoughtToText(parts);
		expect(out).toEqual([
			{ type: "text", id: "r1", text: "This is actually the answer." },
		]);
	});

	it("promotes only the last reasoning block when several exist", () => {
		const parts = [
			{ type: "reasoning", id: "r1", text: "scratchpad" },
			{ type: "tool", id: "t1" },
			{ type: "reasoning", id: "r2", text: "final body" },
		];
		const out = promoteOrphanThoughtToText(parts);
		expect(out[0]).toMatchObject({ type: "reasoning", text: "scratchpad" });
		expect(out[2]).toMatchObject({ type: "text", text: "final body" });
	});

	it("leaves parts alone when text already present", () => {
		const parts = [
			{ type: "reasoning", id: "r1", text: "think" },
			{ type: "text", id: "a1", text: "answer" },
		];
		expect(promoteOrphanThoughtToText(parts)).toEqual(parts);
	});
});
