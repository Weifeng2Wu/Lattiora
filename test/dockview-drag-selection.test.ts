import type { DockviewApi } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import {
	DOCKVIEW_DRAGGING_CLASS,
	installDockviewDragSelectionGuard,
} from "@/lib/workspace/dockview-drag-selection";

class FakePointerEvent extends Event {
	readonly pointerId: number;

	constructor(type: string, init: PointerEventInit = {}) {
		super(type, init);
		this.pointerId = init.pointerId ?? 0;
	}
}

function emitter<T>() {
	const listeners = new Set<(event: T) => void>();
	return {
		event(listener: (event: T) => void) {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		fire(event: T) {
			for (const listener of listeners) listener(event);
		},
	};
}

function harness() {
	const panelDrag = emitter<{ nativeEvent: DragEvent | PointerEvent }>();
	const groupDrag = emitter<{ nativeEvent: DragEvent | PointerEvent }>();
	const classes = new Set<string>();
	const body = {
		classList: {
			add: (name: string) => classes.add(name),
			remove: (name: string) => classes.delete(name),
		},
	};
	const ownerWindow = Object.assign(new EventTarget(), {
		PointerEvent: FakePointerEvent,
	});
	const ownerDocument = Object.assign(new EventTarget(), {
		body,
		defaultView: ownerWindow,
		visibilityState: "visible" as DocumentVisibilityState,
	});
	const root = { ownerDocument } as unknown as HTMLElement;
	const api = {
		onWillDragPanel: panelDrag.event,
		onWillDragGroup: groupDrag.event,
	} as unknown as Pick<DockviewApi, "onWillDragGroup" | "onWillDragPanel">;
	const guard = installDockviewDragSelectionGuard(root, api);

	return {
		classes,
		guard,
		groupDrag,
		ownerDocument,
		ownerWindow,
		panelDrag,
		pointer(type: string, pointerId: number) {
			return new FakePointerEvent(type, { pointerId });
		},
	};
}

describe("Dockview drag selection guard", () => {
	it("suppresses selection for panel and group pointer drags", () => {
		const h = harness();

		h.panelDrag.fire({ nativeEvent: h.pointer("pointerdown", 3) });
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(true);
		h.ownerWindow.dispatchEvent(h.pointer("pointerup", 3));
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(false);

		h.groupDrag.fire({ nativeEvent: h.pointer("pointerdown", 4) });
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(true);
		h.ownerWindow.dispatchEvent(h.pointer("pointercancel", 4));
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(false);

		h.guard.dispose();
	});

	it("ignores HTML5 drags and unrelated pointers", () => {
		const h = harness();

		h.panelDrag.fire({ nativeEvent: new Event("dragstart") as DragEvent });
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(false);

		h.panelDrag.fire({ nativeEvent: h.pointer("pointerdown", 7) });
		h.ownerWindow.dispatchEvent(h.pointer("pointerup", 8));
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(true);
		h.ownerWindow.dispatchEvent(h.pointer("pointerup", 7));
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(false);

		h.guard.dispose();
	});

	it("cancels the active Dockview drag on blur or document hiding", () => {
		const h = harness();
		const cancelled = vi.fn();
		h.ownerWindow.addEventListener("pointercancel", cancelled);

		h.panelDrag.fire({ nativeEvent: h.pointer("pointerdown", 11) });
		h.ownerWindow.dispatchEvent(new Event("blur"));
		expect(cancelled).toHaveBeenCalledOnce();
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(false);

		h.groupDrag.fire({ nativeEvent: h.pointer("pointerdown", 12) });
		h.ownerDocument.visibilityState = "hidden";
		h.ownerDocument.dispatchEvent(new Event("visibilitychange"));
		expect(cancelled).toHaveBeenCalledTimes(2);
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(false);

		h.guard.dispose();
	});

	it("cleans up idempotently and cannot reactivate after disposal", () => {
		const h = harness();

		h.panelDrag.fire({ nativeEvent: h.pointer("pointerdown", 15) });
		h.guard.dispose();
		h.guard.dispose();
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(false);

		h.panelDrag.fire({ nativeEvent: h.pointer("pointerdown", 16) });
		h.groupDrag.fire({ nativeEvent: h.pointer("pointerdown", 17) });
		expect(h.classes.has(DOCKVIEW_DRAGGING_CLASS)).toBe(false);
	});
});
