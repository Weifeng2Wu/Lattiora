import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPendingSessionRegistry } from "@/lib/core/pending-session-registry";

type Write = { id: string };

function createRegistry(graceMs?: number) {
	return createPendingSessionRegistry<Write>({
		ttlMs: 1000,
		maxSessions: 2,
		graceMs,
	});
}

describe("pending session registry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("merges writes per session and drains on take", () => {
		const registry = createRegistry();
		registry.remember("rt-1", [{ id: "a" }]);
		registry.remember("rt-1", [{ id: "b" }]);
		expect(registry.take("rt-1")).toEqual([{ id: "a" }, { id: "b" }]);
		expect(registry.take("rt-1")).toEqual([]);
	});

	it("ignores empty sessions or writes", () => {
		const registry = createRegistry();
		registry.remember("", [{ id: "a" }]);
		registry.remember("rt-1", []);
		expect(registry.isPending("")).toBe(false);
		expect(registry.isPending("rt-1")).toBe(false);
		expect(registry.take("rt-1")).toEqual([]);
	});

	it("prunes sessions past the TTL but not at the exact boundary", () => {
		const registry = createRegistry();
		registry.remember("rt-old", [{ id: "a" }]);
		vi.advanceTimersByTime(10);
		registry.remember("rt-new", [{ id: "b" }]);
		vi.advanceTimersByTime(990);
		expect(registry.isPending("rt-old")).toBe(true);
		vi.advanceTimersByTime(1);
		expect(registry.isPending("rt-old")).toBe(false);
		expect(registry.take("rt-old")).toEqual([]);
		expect(registry.take("rt-new")).toEqual([{ id: "b" }]);
	});

	it("evicts the least recently updated session over the cap", () => {
		const registry = createRegistry();
		registry.remember("rt-a", [{ id: "a" }]);
		vi.advanceTimersByTime(5);
		registry.remember("rt-b", [{ id: "b" }]);
		vi.advanceTimersByTime(5);
		registry.remember("rt-c", [{ id: "c" }]);
		expect(registry.isPending("rt-a")).toBe(false);
		expect(registry.isPending("rt-b")).toBe(true);
		expect(registry.isPending("rt-c")).toBe(true);
	});

	it("keeps a just-taken session pending for the grace window", () => {
		const registry = createRegistry(30);
		registry.remember("rt-1", [{ id: "a" }]);
		expect(registry.take("rt-1")).toEqual([{ id: "a" }]);
		expect(registry.isPending("rt-1")).toBe(true);
		vi.advanceTimersByTime(29);
		expect(registry.isPending("rt-1")).toBe(true);
		vi.advanceTimersByTime(1);
		expect(registry.isPending("rt-1")).toBe(false);
	});

	it("does not grant grace for an empty take", () => {
		const registry = createRegistry(30);
		registry.take("rt-1");
		expect(registry.isPending("rt-1")).toBe(false);
	});

	it("treats a taken session as not pending without a grace window", () => {
		const registry = createRegistry();
		registry.remember("rt-1", [{ id: "a" }]);
		registry.take("rt-1");
		expect(registry.isPending("rt-1")).toBe(false);
	});

	it("resetForTests clears pending and grace state", () => {
		const registry = createRegistry(30);
		registry.remember("rt-1", [{ id: "a" }]);
		registry.take("rt-1");
		registry.resetForTests();
		expect(registry.isPending("rt-1")).toBe(false);
		registry.remember("rt-1", [{ id: "b" }]);
		expect(registry.take("rt-1")).toEqual([{ id: "b" }]);
	});
});
