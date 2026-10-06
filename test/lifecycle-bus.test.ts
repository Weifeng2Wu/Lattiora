import { beforeEach, describe, expect, it, vi } from "vitest";
import { emit, emitScoped, on } from "@/lib/lifecycle/bus";

vi.mock("@/lib/core/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const tick = () => new Promise((r) => setTimeout(r, 0));
/** The scope chain plus handler microtasks need several turns to fully drain. */
async function drain(): Promise<void> {
	for (let i = 0; i < 6; i += 1) await tick();
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const vaultPayload = (vaultId: string) => ({ vaultId, timestamp: 1 });
const paperPayload = { paperId: "a", timestamp: 1 };

describe("lifecycle bus", () => {
	let calls: string[];
	let cleanups: Array<() => void>;

	beforeEach(async () => {
		// Release everything and let in-flight chain work land before the next
		// test starts recording, so scopes never bleed across tests.
		for (const fn of cleanups ?? []) fn();
		await drain();
		cleanups = [];
		calls = [];
	});

	function track<T extends () => void>(fn: T): T {
		cleanups.push(fn);
		return fn;
	}

	it("runs fact handlers serially in registration order", async () => {
		track(
			on("paper:opened", async () => {
				await tick();
				calls.push("first");
			}),
		);
		track(on("paper:opened", () => void calls.push("second")));

		await emit("paper:opened", paperPayload);

		expect(calls).toEqual(["first", "second"]);
	});

	it("keeps running later handlers when one throws", async () => {
		track(
			on("paper:opened", () => {
				throw new Error("boom");
			}),
		);
		track(on("paper:opened", () => void calls.push("after")));

		await emit("paper:opened", paperPayload);

		expect(calls).toEqual(["after"]);
	});

	it("ignores a value returned from a fact handler", async () => {
		const teardown = vi.fn();
		track(on("paper:opened", () => teardown as unknown as undefined));

		await emit("paper:opened", paperPayload);
		await drain();

		expect(teardown).not.toHaveBeenCalled();
	});

	it("tears scoped handlers down in reverse registration order", async () => {
		track(
			on("vault:opened", () => {
				calls.push("setup-a");
				return () => void calls.push("teardown-a");
			}),
		);
		track(
			on("vault:opened", () => {
				calls.push("setup-b");
				return () => void calls.push("teardown-b");
			}),
		);

		const release = track(emitScoped("vault:opened", vaultPayload("/v1")));
		await drain();
		expect(calls).toEqual(["setup-a", "setup-b"]);

		release();
		await drain();
		expect(calls).toEqual(["setup-a", "setup-b", "teardown-b", "teardown-a"]);
	});

	it("skips setup when the scope is released before it starts", async () => {
		track(
			on("vault:opened", () => {
				calls.push("setup");
				return () => void calls.push("teardown");
			}),
		);

		// StrictMode mount → unmount before the queued setup gets a turn.
		emitScoped("vault:opened", vaultPayload("/v1"))();
		await drain();

		expect(calls).toEqual([]);
	});

	it("orders teardown before the next setup when released mid-flight", async () => {
		const gate = deferred();
		track(
			on("vault:opened", async ({ vaultId }) => {
				if (vaultId === "/v1") await gate.promise;
				calls.push(`setup:${vaultId}`);
				return () => void calls.push(`teardown:${vaultId}`);
			}),
		);

		const release = emitScoped("vault:opened", vaultPayload("/v1"));
		await tick(); // first setup is now parked on the gate
		// Fast vault switch: release while setup is still running, open the next
		// scope in the same tick.
		release();
		track(emitScoped("vault:opened", vaultPayload("/v2")));
		gate.resolve();
		await drain();

		expect(calls).toEqual(["setup:/v1", "teardown:/v1", "setup:/v2"]);
	});

	it("is idempotent when the scope is released twice", async () => {
		track(on("vault:opened", () => () => void calls.push("teardown")));

		const release = emitScoped("vault:opened", vaultPayload("/v1"));
		await drain();
		release();
		release();
		await drain();

		expect(calls).toEqual(["teardown"]);
	});

	it("disposes the same handler registered twice independently", async () => {
		const handler = () => void calls.push("hit");
		const offFirst = on("paper:opened", handler);
		track(on("paper:opened", handler));

		offFirst();
		await emit("paper:opened", paperPayload);

		expect(calls).toEqual(["hit"]);
	});

	it("tears down a handler disposed while its setup was in flight", async () => {
		const gate = deferred();
		const off = on("vault:opened", async () => {
			await gate.promise;
			return () => void calls.push("teardown");
		});
		track(off);

		track(emitScoped("vault:opened", vaultPayload("/v1")));
		await tick();
		off();
		gate.resolve();
		await drain();

		expect(calls).toEqual(["teardown"]);
	});

	it("runs a pending teardown when the handler is disposed after setup", async () => {
		const off = track(
			on("vault:opened", () => () => void calls.push("teardown")),
		);

		track(emitScoped("vault:opened", vaultPayload("/v1")));
		await drain();
		expect(calls).toEqual([]);

		off();
		expect(calls).toEqual(["teardown"]);
	});
});
