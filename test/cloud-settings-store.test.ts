import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
beforeAll(() => {
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: { request: async (_name: string, fn: () => unknown) => fn() },
	});
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => storage.set(k, v),
		removeItem: (k: string) => storage.delete(k),
	});
});
afterAll(() => vi.unstubAllGlobals());

it("migrates preferences, removes legacy plaintext credentials, persists rapid offline edits and keeps conflicts", async () => {
	storage.set(
		"agentero-settings",
		JSON.stringify({
			uiTheme: "amethyst-haze",
			allowFileExtensionRename: "true",
			easyScholarKey: "legacy-secret",
		}),
	);
	const { ensureSettingsLoaded, loadSettings, saveSettingsAsync } =
		await import("@/lib/settings/store");
	const { readLocalFile, writeLocalFile, listLocalFiles } = await import(
		"@/lib/cloud/files"
	);
	await ensureSettingsLoaded();
	expect(loadSettings().allowFileExtensionRename).toBe(false);
	expect(storage.has("agentero-settings")).toBe(false);
	const filename = ".agentero/settings.json";
	expect(await (await readLocalFile(filename)).text()).not.toContain(
		"legacy-secret",
	);
	Object.defineProperty(navigator, "onLine", {
		value: false,
		configurable: true,
	});
	const a = saveSettingsAsync({ ...loadSettings(), uiScale: 1.12 });
	const b = saveSettingsAsync({
		...loadSettings(),
		editorFontSize: 18,
		allowFileExtensionRename: true,
	});
	await Promise.all([a, b]);
	const saved = JSON.parse(await (await readLocalFile(filename)).text());
	expect(saved).toMatchObject({
		uiScale: 1.12,
		editorFontSize: 18,
		allowFileExtensionRename: true,
	});
	expect(loadSettings().uiScale).toBe(1.12);
	await expect(
		saveSettingsAsync({
			...loadSettings(),
			embedding: { ...loadSettings().embedding, apiKey: "offline-secret" },
		}),
	).rejects.toThrow("settingsKeyOnline");
	expect(JSON.stringify(loadSettings())).not.toContain("offline-secret");
	expect(await (await readLocalFile(filename)).text()).not.toContain(
		"offline-secret",
	);
	const other = { ...saved, editorFontSize: 20 };
	await writeLocalFile(
		filename,
		new Blob([JSON.stringify(other)], { type: "application/json" }),
	);
	await saveSettingsAsync({ ...loadSettings(), editorFontSize: 16 });
	const conflicts = (await listLocalFiles()).filter(
		(file) =>
			file.path.startsWith("Conflicts/") && file.path.endsWith(filename),
	);
	expect(conflicts).toHaveLength(1);
	expect(JSON.parse(await conflicts[0].data!.text()).editorFontSize).toBe(20);
});

it("sends a new key only to the secret endpoint and never stores it in the UI snapshot or file outbox", async () => {
	Object.defineProperty(navigator, "onLine", {
		value: true,
		configurable: true,
	});
	const calls: Array<{ path: string; body: any }> = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string, init?: RequestInit) => {
			calls.push({
				path,
				body: init?.body ? JSON.parse(String(init.body)) : null,
			});
			return Response.json(
				init?.method === "PUT"
					? { version: 1, configured: true }
					: { secrets: [] },
			);
		}),
	);
	const { loadSettings, saveSettingsAsync } = await import(
		"@/lib/settings/store"
	);
	const { readLocalFile } = await import("@/lib/cloud/files");
	const pending = saveSettingsAsync({
		...loadSettings(),
		embedding: {
			...loadSettings().embedding,
			apiKey: "online-secret",
			baseUrl: "https://embedding.test/v1",
			model: "embedding-model",
		},
	});
	expect(loadSettings().embedding.apiKey).toMatch(/^\*+$/);
	await pending;
	expect(calls.find((call) => call.body?.value === "online-secret")?.path).toBe(
		"/api/settings/secrets",
	);
	const text = await (await readLocalFile(".agentero/settings.json")).text();
	expect(text).not.toContain("online-secret");
	expect(JSON.parse(text).embedding).toMatchObject({
		apiKey: "********",
		model: "embedding-model",
	});
	expect([...storage.values()].join(" ")).not.toContain("online-secret");
});
