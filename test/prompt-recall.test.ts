import { describe, expect, it } from "vitest";
import {
	collectUserPromptTexts,
	findLastUserMessageIndex,
	nextHistoryIndexOnDown,
	nextHistoryIndexOnUp,
	shouldNavigateHistoryDown,
	shouldNavigateHistoryUp,
	shouldRecallPreviousPrompt,
} from "@/lib/ui/prompt-recall";

describe("shouldNavigateHistoryUp", () => {
	it("accepts ArrowUp on empty input with caret at start", () => {
		expect(
			shouldNavigateHistoryUp(
				{ key: "ArrowUp" },
				{ value: "", selectionStart: 0, selectionEnd: 0 },
				false,
			),
		).toBe(true);
	});

	it("accepts whitespace-only draft when not browsing", () => {
		expect(
			shouldNavigateHistoryUp(
				{ key: "ArrowUp" },
				{ value: "  \n", selectionStart: 0, selectionEnd: 0 },
				false,
			),
		).toBe(true);
	});

	it("rejects non-empty draft when not browsing", () => {
		expect(
			shouldNavigateHistoryUp(
				{ key: "ArrowUp" },
				{ value: "hello", selectionStart: 0, selectionEnd: 0 },
				false,
			),
		).toBe(false);
	});

	it("accepts non-empty value while browsing (caret at start)", () => {
		expect(
			shouldNavigateHistoryUp(
				{ key: "ArrowUp" },
				{ value: "older prompt", selectionStart: 0, selectionEnd: 0 },
				true,
			),
		).toBe(true);
	});

	it("rejects when caret is not at start", () => {
		expect(
			shouldNavigateHistoryUp(
				{ key: "ArrowUp" },
				{ value: "", selectionStart: 1, selectionEnd: 1 },
				false,
			),
		).toBe(false);
	});
});

describe("shouldNavigateHistoryDown", () => {
	it("rejects when not browsing", () => {
		expect(
			shouldNavigateHistoryDown(
				{ key: "ArrowDown" },
				{ value: "x", selectionStart: 1, selectionEnd: 1 },
				false,
			),
		).toBe(false);
	});

	it("accepts caret at end while browsing", () => {
		expect(
			shouldNavigateHistoryDown(
				{ key: "ArrowDown" },
				{ value: "hello", selectionStart: 5, selectionEnd: 5 },
				true,
			),
		).toBe(true);
	});

	it("rejects caret mid-text while browsing", () => {
		expect(
			shouldNavigateHistoryDown(
				{ key: "ArrowDown" },
				{ value: "hello", selectionStart: 2, selectionEnd: 2 },
				true,
			),
		).toBe(false);
	});
});

describe("shouldRecallPreviousPrompt (compat)", () => {
	it("matches first-entry history Up rules", () => {
		expect(
			shouldRecallPreviousPrompt(
				{ key: "ArrowUp" },
				{ value: "", selectionStart: 0, selectionEnd: 0 },
			),
		).toBe(true);
		expect(
			shouldRecallPreviousPrompt(
				{ key: "ArrowUp" },
				{ value: "hello", selectionStart: 0, selectionEnd: 0 },
			),
		).toBe(false);
	});
});

describe("history index walk", () => {
	it("Up from idle selects newest", () => {
		expect(nextHistoryIndexOnUp(3, null)).toBe(2);
	});

	it("Up walks toward older and clamps at oldest", () => {
		expect(nextHistoryIndexOnUp(3, 2)).toBe(1);
		expect(nextHistoryIndexOnUp(3, 1)).toBe(0);
		expect(nextHistoryIndexOnUp(3, 0)).toBe(0);
	});

	it("Down walks toward newer and exits past newest", () => {
		expect(nextHistoryIndexOnDown(3, 0)).toBe(1);
		expect(nextHistoryIndexOnDown(3, 1)).toBe(2);
		expect(nextHistoryIndexOnDown(3, 2)).toBe(null);
	});

	it("empty history stays null", () => {
		expect(nextHistoryIndexOnUp(0, null)).toBe(null);
		expect(nextHistoryIndexOnDown(0, 0)).toBe(null);
	});
});

describe("collectUserPromptTexts", () => {
	it("collects user texts oldest-first and strips via mapper", () => {
		const lines = [
			{ kind: "user", text: "  first  " },
			{ kind: "agent", text: "reply" },
			{ kind: "user", text: "second" },
			{ kind: "system", text: "note" },
		];
		expect(collectUserPromptTexts(lines, (s) => s.trim())).toEqual([
			"first",
			"second",
		]);
	});
});

describe("findLastUserMessageIndex", () => {
	it("finds last user by kind (Agent chat lines)", () => {
		const lines = [
			{ kind: "user" },
			{ kind: "agent" },
			{ kind: "user" },
			{ kind: "agent" },
		];
		expect(findLastUserMessageIndex(lines)).toBe(2);
	});

	it("finds last user by role (PDF ask messages)", () => {
		const messages = [
			{ role: "user" },
			{ role: "assistant" },
			{ role: "system" },
		];
		expect(findLastUserMessageIndex(messages)).toBe(0);
	});

	it("returns -1 when none", () => {
		expect(findLastUserMessageIndex([{ kind: "agent" }])).toBe(-1);
		expect(findLastUserMessageIndex([])).toBe(-1);
	});
});
