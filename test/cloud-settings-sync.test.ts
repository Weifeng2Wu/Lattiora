import { afterAll, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
	read: vi.fn<() => Promise<Record<string, unknown> | null>>(),
	write: vi.fn(async (next: unknown) => next),
	listener: null as null | ((paths: string[], remote: boolean) => void),
}));
vi.mock("@/lib/cloud/settings", () => ({
	SETTINGS_FILE: ".agentero/settings.json",
	readCloudSettings: io.read,
	persistCloudSettings: io.write,
}));
vi.mock("@/lib/cloud/files", () => ({
	subscribeCloudFiles: (fn: typeof io.listener) => {
		io.listener = fn;
	},
}));
vi.mock("@/lib/core/notify", () => ({ notifyError: vi.fn() }));
afterAll(() => vi.unstubAllGlobals());

it("keeps an edit made while a remote settings snapshot is being read", async () => {
	vi.stubGlobal("localStorage", { getItem: () => null, removeItem: () => {} });
	io.read.mockResolvedValueOnce({ uiScale: 1 });
	const store = await import("@/lib/settings/store");
	await store.ensureSettingsLoaded();
	store.initSettingsSync();
	let resolveRead!: (value: Record<string, unknown>) => void;
	io.read.mockReturnValueOnce(
		new Promise((resolve) => {
			resolveRead = resolve;
		}),
	);
	io.listener?.([".agentero/settings.json"], true);
	await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2));
	const edit = store.saveSettingsAsync({
		...store.loadSettings(),
		uiScale: 1.12,
	});
	resolveRead({ uiScale: 1.14 });
	await edit;
	expect(store.loadSettings().uiScale).toBe(1.12);
	expect(io.write).toHaveBeenLastCalledWith(
		expect.objectContaining({ uiScale: 1.12 }),
		expect.anything(),
	);
});
