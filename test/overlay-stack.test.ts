import { afterEach, describe, expect, it, vi } from "vitest";

import {
	closeOverlayById,
	closeTopOverlay,
	getOverlayStackSnapshot,
	isAnyModalOverlayOpen,
	isAnyOverlayOpen,
	pushOverlay,
} from "@/lib/core/overlay-stack";

afterEach(() => {
	while (isAnyOverlayOpen()) {
		closeTopOverlay();
	}
});

describe("overlay-stack", () => {
	it("pushes and closes top first (LIFO)", () => {
		const a = vi.fn();
		const b = vi.fn();
		pushOverlay({ id: "a", close: a });
		pushOverlay({ id: "b", close: b });

		expect(isAnyOverlayOpen()).toBe(true);
		expect(getOverlayStackSnapshot().map((h) => h.id)).toEqual(["a", "b"]);

		expect(closeTopOverlay()).toBe(true);
		expect(b).toHaveBeenCalledTimes(1);
		expect(a).not.toHaveBeenCalled();
		expect(getOverlayStackSnapshot().map((h) => h.id)).toEqual(["a"]);

		expect(closeTopOverlay()).toBe(true);
		expect(a).toHaveBeenCalledTimes(1);
		expect(isAnyOverlayOpen()).toBe(false);
		expect(closeTopOverlay()).toBe(false);
	});

	it("re-push moves an id to the top", () => {
		pushOverlay({ id: "a", close: () => {} });
		pushOverlay({ id: "b", close: () => {} });
		pushOverlay({ id: "a", close: () => {} });

		expect(getOverlayStackSnapshot().map((h) => h.id)).toEqual(["b", "a"]);
	});

	it("closeOverlayById targets a specific layer", () => {
		const a = vi.fn();
		const b = vi.fn();
		pushOverlay({ id: "a", close: a });
		pushOverlay({ id: "b", close: b });

		expect(closeOverlayById("a")).toBe(true);
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).not.toHaveBeenCalled();
		expect(getOverlayStackSnapshot().map((h) => h.id)).toEqual(["b"]);
	});

	it("non-modal overlays count toward isAnyOverlayOpen but not isAnyModalOverlayOpen", () => {
		const modal = vi.fn();
		const docked = vi.fn();
		pushOverlay({ id: "modal", close: modal });
		pushOverlay({ id: "docked", close: docked, modal: false });

		expect(isAnyOverlayOpen()).toBe(true);
		expect(isAnyModalOverlayOpen()).toBe(true);

		expect(closeTopOverlay()).toBe(true);
		expect(docked).toHaveBeenCalledTimes(1);
		expect(modal).not.toHaveBeenCalled();
		expect(isAnyOverlayOpen()).toBe(true);
		expect(isAnyModalOverlayOpen()).toBe(true);

		expect(closeTopOverlay()).toBe(true);
		expect(modal).toHaveBeenCalledTimes(1);
		expect(isAnyOverlayOpen()).toBe(false);
		expect(isAnyModalOverlayOpen()).toBe(false);
	});

	it("defaults modal to true when omitted", () => {
		pushOverlay({ id: "default", close: () => {} });
		expect(isAnyModalOverlayOpen()).toBe(true);
		closeTopOverlay();
	});
});

describe("overlay-stack modal gating", () => {
	it("non-modal surfaces do not count for modal gating", () => {
		pushOverlay({ id: "agent-ask-user", close: () => {}, modal: false });

		expect(isAnyOverlayOpen()).toBe(true);
		expect(isAnyModalOverlayOpen()).toBe(false);
	});

	it("default (modal) overlays count for modal gating", () => {
		pushOverlay({ id: "settings", close: () => {} });

		expect(isAnyModalOverlayOpen()).toBe(true);
	});

	it("closeTopOverlay still dismisses non-modal surfaces (Esc / ⌘W)", () => {
		const close = vi.fn();
		pushOverlay({ id: "agent-ask-user", close, modal: false });

		expect(closeTopOverlay()).toBe(true);
		expect(close).toHaveBeenCalledTimes(1);
		expect(isAnyOverlayOpen()).toBe(false);
	});

	it("modal gating reflects mixed stacks", () => {
		pushOverlay({ id: "agent-ask-user", close: () => {}, modal: false });
		pushOverlay({ id: "paper-search", close: () => {} });
		expect(isAnyModalOverlayOpen()).toBe(true);

		// Close the modal one; non-modal remains → gating clears.
		closeOverlayById("paper-search");
		expect(isAnyOverlayOpen()).toBe(true);
		expect(isAnyModalOverlayOpen()).toBe(false);
	});
});
