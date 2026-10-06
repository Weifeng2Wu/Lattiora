import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfDestMaps } from "@/lib/pdf/citation-dest-keys";
import {
	clearCitationDestKeyMapCache,
	getPdfDestMapsCached,
} from "@/lib/pdf/citation-dest-map";

/** Build a maps object with just the cite index populated. */
function citeMaps(entries: [string, string][]): PdfDestMaps {
	return {
		cites: new Map(entries),
		crossrefs: new Map(),
		crossrefKinds: new Map(),
		crossrefLabels: new Map(),
		crossrefLinks: [],
		citationLinks: [],
	};
}

describe("pdf dest maps cache", () => {
	beforeEach(() => {
		clearCitationDestKeyMapCache();
	});

	it("parses once and serves the second request from cache", async () => {
		const maps = citeMaps([["3:100.0", "smith2020"]]);
		const parse = vi.fn().mockResolvedValue(maps);

		const first = await getPdfDestMapsCached(
			"/vault/papers/p1/p1.pdf:1234",
			"viewer-bytes",
			parse,
		);
		const second = await getPdfDestMapsCached(
			"/vault/papers/p1/p1.pdf:1234",
			"viewer-bytes",
			parse,
		);

		expect(parse).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
		expect(second.cites.get("3:100.0")).toBe("smith2020");
	});

	it("dedupes concurrent requests for the same PDF", async () => {
		const parse = vi.fn().mockResolvedValue(citeMaps([]));
		const [a, b] = await Promise.all([
			getPdfDestMapsCached("k:1", "disk", parse),
			getPdfDestMapsCached("k:1", "disk", parse),
		]);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(b).toBe(a);
	});

	it("keys by pdf path + size, so a different PDF parses again", async () => {
		const parse = vi.fn().mockResolvedValue(citeMaps([]));
		await getPdfDestMapsCached("/a.pdf:10", "disk", parse);
		await getPdfDestMapsCached("/a.pdf:20", "disk", parse);
		await getPdfDestMapsCached("/b.pdf:10", "disk", parse);
		expect(parse).toHaveBeenCalledTimes(3);
	});

	it("does not cache failures, allowing a retry", async () => {
		const parse = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(citeMaps([["0:0.0", "ok"]]));

		await expect(getPdfDestMapsCached("k:2", "disk", parse)).rejects.toThrow(
			"boom",
		);
		const retried = await getPdfDestMapsCached("k:2", "disk", parse);
		expect(parse).toHaveBeenCalledTimes(2);
		expect(retried.cites.get("0:0.0")).toBe("ok");
	});
});
