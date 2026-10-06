import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listenEventSafe = vi.fn();

vi.mock("@/lib/core/tauri-events", () => ({
	listenEventSafe: (...args: unknown[]) => listenEventSafe(...args),
}));

vi.mock("@/lib/core/bindings", () => ({
	events: {
		vaultFileChanged: { listen: vi.fn() },
	},
}));

import { listenVaultFileChangedGated } from "@/lib/vault/file-change-gate";

type Listener = () => void;

describe("listenVaultFileChangedGated", () => {
	let visibility: DocumentVisibilityState;
	let focused: boolean;
	let onVisibility: Listener[];
	let onFocus: Listener[];
	let onBlur: Listener[];
	let hostHandler:
		| ((payload: { paths: string[]; kind: string }) => void)
		| null;

	beforeEach(() => {
		visibility = "visible";
		focused = true;
		onVisibility = [];
		onFocus = [];
		onBlur = [];
		hostHandler = null;

		const documentStub = {
			get visibilityState() {
				return visibility;
			},
			hasFocus: () => focused,
			addEventListener: (
				type: string,
				listener: EventListenerOrEventListenerObject,
			) => {
				if (type === "visibilitychange" && typeof listener === "function") {
					onVisibility.push(listener as Listener);
				}
			},
			removeEventListener: () => undefined,
		};
		const windowStub = {
			addEventListener: (
				type: string,
				listener: EventListenerOrEventListenerObject,
			) => {
				if (type === "focus" && typeof listener === "function") {
					onFocus.push(listener as Listener);
				}
				if (type === "blur" && typeof listener === "function") {
					onBlur.push(listener as Listener);
				}
			},
			removeEventListener: () => undefined,
		};

		vi.stubGlobal("document", documentStub);
		vi.stubGlobal("window", windowStub);

		listenEventSafe.mockImplementation((_event, handler) => {
			hostHandler = handler as typeof hostHandler;
			return () => {
				hostHandler = null;
			};
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		listenEventSafe.mockReset();
	});

	it("delivers immediately while the shell is active", async () => {
		const seen: string[] = [];
		const stop = listenVaultFileChangedGated((payload) => {
			seen.push(payload.paths[0] ?? "");
		});
		hostHandler?.({ paths: ["/a.md"], kind: "modify" });
		await Promise.resolve();
		expect(seen).toEqual(["/a.md"]);
		stop();
	});

	it("buffers while hidden and flushes after becoming visible again", async () => {
		const seen: string[] = [];
		const stop = listenVaultFileChangedGated((payload) => {
			seen.push(payload.paths[0] ?? "");
		});

		visibility = "hidden";
		for (const fire of onVisibility) fire();
		hostHandler?.({ paths: ["/b.md"], kind: "modify" });
		hostHandler?.({ paths: ["/c.md"], kind: "modify" });
		await Promise.resolve();
		expect(seen).toEqual([]);

		visibility = "visible";
		focused = true;
		for (const fire of onVisibility) fire();
		await Promise.resolve();
		await Promise.resolve();
		expect(seen).toEqual(["/b.md", "/c.md"]);
		stop();
	});

	it("buffers while unfocused and flushes on focus", async () => {
		const seen: string[] = [];
		const stop = listenVaultFileChangedGated((payload) => {
			seen.push(payload.paths[0] ?? "");
		});

		focused = false;
		for (const fire of onBlur) fire();
		hostHandler?.({ paths: ["/d.md"], kind: "create" });
		await Promise.resolve();
		expect(seen).toEqual([]);

		focused = true;
		for (const fire of onFocus) fire();
		await Promise.resolve();
		await Promise.resolve();
		expect(seen).toEqual(["/d.md"]);
		stop();
	});
});
