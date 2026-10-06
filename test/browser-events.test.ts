import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventCallback, UnlistenFn } from "@/lib/core/browser-events";
import {
	listenEventSafe,
	type TypedEventBinding,
} from "@/lib/core/tauri-events";

const mocks = vi.hoisted(() => ({
	tauri: true,
	subscriptions: [] as Array<{
		cb: EventCallback<unknown>;
		resolve: (off: UnlistenFn) => void;
	}>,
}));

vi.mock("@/lib/core/tauri", () => ({ isTauri: () => mocks.tauri }));

/**
 * Fake of one generated specta binding (`events.*` in `@/lib/core/bindings`):
 * `listen` is invoked synchronously but stays pending until the test resolves
 * it, mirroring the real IPC round-trip.
 */
function fakeEventBinding<T>(): TypedEventBinding<T> {
	return {
		listen: (cb: EventCallback<T>) =>
			new Promise<UnlistenFn>((resolve) => {
				mocks.subscriptions.push({
					cb: cb as EventCallback<unknown>,
					resolve,
				});
			}),
	};
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("listenEventSafe", () => {
	beforeEach(() => {
		mocks.tauri = true;
		mocks.subscriptions.length = 0;
	});

	it("unlistens even when disposed before listen resolves", async () => {
		const off = vi.fn();

		const dispose = listenEventSafe(fakeEventBinding<never>(), () => undefined);
		// The typed binding's listen is called synchronously; the IPC promise
		// is still pending here.
		expect(mocks.subscriptions).toHaveLength(1);
		dispose(); // the leaky pattern would no-op here

		mocks.subscriptions[0]?.resolve(off);
		await flush();

		expect(off).toHaveBeenCalledTimes(1);
	});

	it("delivers the unwrapped payload to the handler", async () => {
		const handler = vi.fn();

		listenEventSafe(fakeEventBinding<{ kind: string }>(), handler);
		mocks.subscriptions[0]?.cb({
			event: "window:closed",
			id: 1,
			payload: { kind: "settings" },
		});

		expect(handler).toHaveBeenCalledWith({ kind: "settings" });
	});

	it("is idempotent on repeated dispose", async () => {
		const off = vi.fn();

		const dispose = listenEventSafe(fakeEventBinding<never>(), () => undefined);
		mocks.subscriptions[0]?.resolve(off);
		await flush();

		dispose();
		dispose();
		await flush();

		expect(off).toHaveBeenCalledTimes(1);
	});
});
