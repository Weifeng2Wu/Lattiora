import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
	clearUsage,
	listUsageEvents,
	recordActivityEvents,
	summarizeUsage,
} from "@/lib/activity/api";

beforeAll(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterAll(() => vi.unstubAllGlobals());
it("keeps reading history locally, filters by time/vault and clears only selected records", async () => {
	await recordActivityEvents([
		{
			kind: "paper.session",
			vault: "one",
			path: "papers/a",
			ts: "2026-09-01T00:00:00Z",
			durMs: 10000,
		},
		{
			kind: "paper.session",
			vault: "one",
			path: "papers/b",
			ts: "2026-09-02T00:00:00Z",
			durMs: 20000,
		},
		{
			kind: "paper.session",
			vault: "two",
			ts: "2026-09-03T00:00:00Z",
			durMs: 30000,
		},
	]);
	expect(await summarizeUsage({ vault: "one" })).toEqual([
		{ kind: "paper.session", count: 2, durMs: 30000 },
	]);
	expect(
		await listUsageEvents({ vault: "one", since: "2026-09-02" }),
	).toHaveLength(1);
	expect(await clearUsage("one")).toBe(2);
	expect(await listUsageEvents()).toHaveLength(1);
	expect(await clearUsage()).toBe(1);
	expect(await summarizeUsage()).toEqual([]);
});
