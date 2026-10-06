import { describe, expect, it, vi } from "vitest";
import {
	flushTextEditorFor,
	registerTextEditorFlusher,
} from "@/lib/workspace/text-editor-flush";

describe("text-editor flush registry", () => {
	it("resolves true for an unmounted editor (disk is current)", async () => {
		await expect(flushTextEditorFor("/vault/thesis/main.tex")).resolves.toBe(
			true,
		);
	});

	it("routes the flush to the mounted editor and passes its result through", async () => {
		const flusher = vi.fn().mockResolvedValue(false);
		const unregister = registerTextEditorFlusher(
			"/vault/thesis/main.tex",
			flusher,
		);

		await expect(flushTextEditorFor("/vault/thesis/main.tex")).resolves.toBe(
			false,
		);
		expect(flusher).toHaveBeenCalledTimes(1);

		unregister();
		await expect(flushTextEditorFor("/vault/thesis/main.tex")).resolves.toBe(
			true,
		);
	});

	it("survives same-path split panes unmounting out of order", async () => {
		const first = vi.fn().mockResolvedValue(true);
		const second = vi.fn().mockResolvedValue(true);
		const unregisterFirst = registerTextEditorFlusher("/v/a.tex", first);
		const unregisterSecond = registerTextEditorFlusher("/v/a.tex", second);

		// Later mount owns the entry; the earlier pane's unmount must not
		// clobber it (only later unmount removes it).
		unregisterFirst();
		await flushTextEditorFor("/v/a.tex");
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);

		unregisterSecond();
		await expect(flushTextEditorFor("/v/a.tex")).resolves.toBe(true);
	});

	it("treats a throwing flusher as a refused flush", async () => {
		const unregister = registerTextEditorFlusher("/v/a.tex", async () => {
			throw new Error("boom");
		});
		await expect(flushTextEditorFor("/v/a.tex")).resolves.toBe(false);
		unregister();
	});
});
