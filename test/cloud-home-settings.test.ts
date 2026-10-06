import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_: string, run: () => unknown) => run() },
	});
});
afterEach(() => vi.unstubAllGlobals());
it("persists ordered optional widgets with conflict protection and validates background bounds", async () => {
	const h = await import("../src/lib/cloud/home-settings");
	const initial = await h.readHomeSettings();
	const value = {
		...initial.value,
		widgets: [
			{ id: "weather" as const, width: 2 as const },
			{ id: "focus" as const, width: 1 as const },
		],
		background: { blur: 12, shade: 50 },
	};
	await h.saveHomeSettings(value, initial.localId);
	expect((await h.readHomeSettings()).value).toEqual(value);
	await expect(
		h.saveHomeSettings(initial.value, initial.localId),
	).rejects.toThrow("localConflict");
	expect(
		h.homeSettingsSchema.safeParse({
			...value,
			widgets: [value.widgets[0], value.widgets[0]],
		}).success,
	).toBe(false);
	expect(
		h.homeSettingsSchema.safeParse({
			...value,
			background: {
				path: "https://example.org/tracking.jpg",
				blur: 8,
				shade: 50,
			},
		}).success,
	).toBe(false);
});
