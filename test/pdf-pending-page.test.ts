import { afterEach, describe, expect, it } from "vitest";
import {
	clearPendingPdfPage,
	consumePendingPdfPage,
	peekPendingPdfPage,
	setPendingPdfPage,
} from "@/lib/pdf/pending-pdf-page";

afterEach(() => {
	clearPendingPdfPage([
		"/vault/papers/a",
		"papers/a",
		"/vault/papers/b",
		"papers/b",
	]);
});

describe("pending pdf page intent", () => {
	it("stores and peeks a 1-based page under aliases", () => {
		setPendingPdfPage(["/vault/papers/a", "papers/a"], 11);
		expect(peekPendingPdfPage("papers/a")).toBe(11);
		expect(peekPendingPdfPage("/vault/papers/a")).toBe(11);
	});

	it("consume clears every alias registered together", () => {
		setPendingPdfPage(["/vault/papers/a", "papers/a"], 11);
		expect(consumePendingPdfPage("papers/a")).toBe(11);
		expect(peekPendingPdfPage("/vault/papers/a")).toBeNull();
		expect(consumePendingPdfPage("/vault/papers/a")).toBeNull();
	});

	it("normalizes trailing slashes and backslashes", () => {
		setPendingPdfPage("papers\\a\\", 3);
		expect(peekPendingPdfPage("papers/a")).toBe(3);
		expect(consumePendingPdfPage("papers/a/")).toBe(3);
	});

	it("ignores invalid pages", () => {
		setPendingPdfPage("papers/a", 0);
		setPendingPdfPage("papers/a", -1);
		expect(peekPendingPdfPage("papers/a")).toBeNull();
	});

	it("replacing a key drops the previous shared intent", () => {
		setPendingPdfPage(["/vault/papers/a", "papers/a"], 5);
		setPendingPdfPage("papers/a", 9);
		expect(peekPendingPdfPage("papers/a")).toBe(9);
		// Previous abs alias was cleared when papers/a was replaced.
		expect(peekPendingPdfPage("/vault/papers/a")).toBeNull();
	});
});
