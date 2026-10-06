import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	const data = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => data.set(key, value),
	});
	vi.stubGlobal("navigator", {
		locks: { request: (_: string, run: () => unknown) => run() },
	});
});
afterEach(() => vi.unstubAllGlobals());
it("counts only observed pages, merges devices, separates AI analysis and resets coverage for a replaced PDF", async () => {
	const f = await import("../src/lib/cloud/files");
	const r = await import("../src/lib/cloud/reading-progress");
	await f.writeLocalFile(
		"papers/a/.paper.json",
		new Blob([JSON.stringify({ id: "a", is_read: false })]),
	);
	await f.writeLocalFile("papers/a/paper.pdf", new Blob(["PDF one"]));
	await r.recordReadingPage("papers/a", 1, 10, 100);
	await r.recordReadingPage("papers/a", 10, 10, 200);
	await r.recordReadingPage("papers/a", 10, 10, 250);
	expect((await r.loadReadingProgress()).get("papers/a")?.pages).toEqual([
		1, 10,
	]);
	localStorage.setItem(
		"agentero-reading-device",
		JSON.stringify(crypto.randomUUID()),
	);
	await r.recordReadingPage("papers/a", 4, 10, 300);
	expect((await r.loadReadingProgress()).get("papers/a")).toMatchObject({
		pages: [1, 4, 10],
		lastPage: 4,
	});
	await r.markPaperAnalyzed("papers/a");
	expect(
		(await r.loadReadingProgress()).get("papers/a")?.analyzedAt,
	).toBeGreaterThan(0);
	expect(
		JSON.parse(await (await f.readLocalFile("papers/a/.paper.json")).text())
			.is_read,
	).toBe(false);
	await f.writeLocalFile("papers/a/paper.pdf", new Blob(["PDF replacement"]));
	expect((await r.loadReadingProgress()).get("papers/a")?.pages).toEqual([]);
});
