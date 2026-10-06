import { describe, expect, it } from "vitest";
import {
	getScrollSyncElement,
	getScrollSyncPartner,
	getScrollSyncPeer,
	getScrollSyncRole,
	mapScrollByContent,
	registerScrollSyncElement,
	registerScrollSyncPair,
	registerScrollSyncPeer,
	type ScrollSyncPeer,
	type SyncScrollMetrics,
	subscribeScrollSyncPeers,
	unregisterScrollSyncPair,
} from "@/lib/pdf/scroll-sync";

function metrics(
	partial: Partial<SyncScrollMetrics> &
		Pick<SyncScrollMetrics, "scrollTop" | "scrollHeight" | "clientHeight">,
): SyncScrollMetrics {
	return {
		scrollLeft: 0,
		scrollWidth: 100,
		clientWidth: 100,
		...partial,
	};
}

function createPeer(initial: {
	scrollTop?: number;
	scrollHeight?: number;
	clientHeight?: number;
	zoom?: number;
}): ScrollSyncPeer & {
	scrollTop: number;
	zoom: number;
	emitScroll: () => void;
	emitZoom: () => void;
} {
	let scrollTop = initial.scrollTop ?? 0;
	const scrollHeight = initial.scrollHeight ?? 1000;
	const clientHeight = initial.clientHeight ?? 200;
	let zoom = initial.zoom ?? 1;
	const scrollListeners = new Set<() => void>();
	const zoomListeners = new Set<(next: number) => void>();
	return {
		get scrollTop() {
			return scrollTop;
		},
		get zoom() {
			return zoom;
		},
		getMetrics: () => metrics({ scrollTop, scrollHeight, clientHeight }),
		scrollTo: ({ y }) => {
			scrollTop = y;
		},
		onScrollChange: (listener) => {
			scrollListeners.add(listener);
			return () => scrollListeners.delete(listener);
		},
		getZoom: () => zoom,
		setZoom: (next) => {
			zoom = next;
		},
		onZoomChange: (listener) => {
			zoomListeners.add(listener);
			return () => zoomListeners.delete(listener);
		},
		emitScroll: () => {
			for (const listener of scrollListeners) listener();
		},
		emitZoom: () => {
			for (const listener of zoomListeners) listener(zoom);
		},
	};
}

describe("mapScrollByContent", () => {
	it("keeps both viewport centers on the same content point across differently sized panes", () => {
		// Same document in two panes with different viewport heights. The
		// source center sits on content y = 700; the target must aim its
		// center there too (700 - 150). The old ratio mapping landed the
		// target center on y = 675 instead.
		const mapped = mapScrollByContent(
			metrics({
				scrollTop: 600,
				scrollHeight: 1000,
				clientHeight: 200,
			}),
			metrics({
				scrollTop: 0,
				scrollHeight: 1000,
				clientHeight: 300,
			}),
		);
		expect(mapped).toEqual({ x: 0, y: 550 });
	});

	it("clamps to the target's scrollable range", () => {
		const mapped = mapScrollByContent(
			metrics({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }),
			metrics({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }),
		);
		// Source center is content y = 100; target top would be -100.
		expect(mapped).toEqual({ x: 0, y: 0 });
	});

	it("returns null while either viewport has no layout yet", () => {
		expect(
			mapScrollByContent(
				metrics({ scrollTop: 0, scrollHeight: 0, clientHeight: 200 }),
				metrics({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }),
			),
		).toBeNull();
	});
});

describe("scroll sync registry", () => {
	it("rewires listeners when a viewport mounts after its peer or is replaced", () => {
		const seen: Array<HTMLElement | null> = [];
		const unsubscribe = subscribeScrollSyncPeers(() =>
			seen.push(getScrollSyncElement("late")),
		);
		const first = {} as HTMLElement;
		const second = {} as HTMLElement;
		const removeFirst = registerScrollSyncElement("late", first);
		const removeSecond = registerScrollSyncElement("late", second);
		removeFirst();
		expect(getScrollSyncElement("late")).toBe(second);
		removeSecond();
		unsubscribe();
		expect(seen).toEqual([first, second, null]);
	});
	it("pairs source and target and exposes roles", () => {
		const groupId = registerScrollSyncPair("paper-a", "paper-a::translation");
		expect(getScrollSyncPartner("paper-a")).toBe("paper-a::translation");
		expect(getScrollSyncPartner("paper-a::translation")).toBe("paper-a");
		expect(getScrollSyncRole("paper-a")).toBe("source");
		expect(getScrollSyncRole("paper-a::translation")).toBe("target");
		unregisterScrollSyncPair(groupId);
		expect(getScrollSyncPartner("paper-a")).toBeNull();
	});

	it("replaces a stale pair for the same documents", () => {
		registerScrollSyncPair("paper-a", "paper-a::translation");
		registerScrollSyncPair("paper-a", "paper-a::translation");
		expect(getScrollSyncPartner("paper-a")).toBe("paper-a::translation");
	});

	it("registers peers and clears them on dispose", () => {
		const peer = createPeer({});
		const dispose = registerScrollSyncPeer("paper-a", peer);
		expect(getScrollSyncPeer("paper-a")).toBe(peer);
		dispose();
		expect(getScrollSyncPeer("paper-a")).toBeNull();
	});
});

describe("scroll sync across buffer revision suffixes", () => {
	// Bytes-backed viewers mount as `tab::r<n>` (fresh revision per ArrayBuffer
	// read) while pairs are registered with tab ids; every registry key strips
	// the revision so both forms resolve to the same entry.
	it("resolves a pair queried with either revision form", () => {
		registerScrollSyncPair("paper-a", "paper-a::translation");
		expect(getScrollSyncPartner("paper-a::r1")).toBe("paper-a::translation");
		expect(getScrollSyncPartner("paper-a::translation::r2")).toBe("paper-a");
		expect(getScrollSyncRole("paper-a::r1")).toBe("source");
		expect(getScrollSyncRole("paper-a::translation::r2")).toBe("target");
	});

	it("retires pairs left behind by earlier buffer revisions", () => {
		registerScrollSyncPair("paper-a::r1", "paper-a::translation::r2");
		registerScrollSyncPair("paper-a", "paper-a::translation");
		expect(getScrollSyncPartner("paper-a::r3")).toBe("paper-a::translation");
		expect(getScrollSyncPartner("paper-a::translation::r4")).toBe("paper-a");
	});

	it("stores peers and elements under the base id", () => {
		const peer = createPeer({});
		const disposePeer = registerScrollSyncPeer(
			"paper-a::translation::r2",
			peer,
		);
		expect(getScrollSyncPeer("paper-a::translation")).toBe(peer);
		expect(getScrollSyncPeer("paper-a::translation::r5")).toBe(peer);
		const element = {} as HTMLElement;
		const disposeElement = registerScrollSyncElement(
			"paper-a::translation::r2",
			element,
		);
		expect(getScrollSyncElement("paper-a::translation")).toBe(element);
		expect(getScrollSyncElement("paper-a::r1")).toBeNull();
		disposePeer();
		disposeElement();
		expect(getScrollSyncPeer("paper-a::translation")).toBeNull();
		expect(getScrollSyncElement("paper-a::translation")).toBeNull();
	});
});
