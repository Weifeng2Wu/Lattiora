import type { DockviewApi } from "dockview-react";

export const DOCKVIEW_DRAGGING_CLASS = "agentero-dockview-dragging";

type DockviewDragApi = Pick<DockviewApi, "onWillDragGroup" | "onWillDragPanel">;

export function installDockviewDragSelectionGuard(
	root: HTMLElement,
	api: DockviewDragApi,
): { dispose: () => void } {
	const ownerDocument = root.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	if (!ownerWindow) return { dispose() {} };

	const PointerEventCtor = ownerWindow.PointerEvent;
	let activePointerId: number | null = null;
	let disposed = false;

	const finish = () => {
		if (activePointerId === null) return;
		activePointerId = null;
		ownerDocument.body.classList.remove(DOCKVIEW_DRAGGING_CLASS);
	};

	const cancel = () => {
		if (activePointerId === null) return;
		const pointerId = activePointerId;
		finish();
		ownerWindow.dispatchEvent(
			new PointerEventCtor("pointercancel", {
				bubbles: true,
				cancelable: true,
				composed: true,
				pointerId,
			}),
		);
	};

	const start = (nativeEvent: DragEvent | PointerEvent) => {
		if (disposed || !(nativeEvent instanceof PointerEventCtor)) return;
		if (activePointerId !== null && activePointerId !== nativeEvent.pointerId) {
			finish();
		}
		activePointerId = nativeEvent.pointerId;
		ownerDocument.body.classList.add(DOCKVIEW_DRAGGING_CLASS);
	};

	const handlePointerUp = (event: PointerEvent) => {
		if (event.pointerId === activePointerId) finish();
	};
	const handlePointerCancel = (event: PointerEvent) => {
		if (event.pointerId === activePointerId) finish();
	};
	const handleVisibilityChange = () => {
		if (ownerDocument.visibilityState === "hidden") cancel();
	};

	const panelDrag = api.onWillDragPanel((event) => start(event.nativeEvent));
	const groupDrag = api.onWillDragGroup((event) => start(event.nativeEvent));
	ownerWindow.addEventListener("pointerup", handlePointerUp);
	ownerWindow.addEventListener("pointercancel", handlePointerCancel);
	ownerWindow.addEventListener("blur", cancel);
	ownerDocument.addEventListener("visibilitychange", handleVisibilityChange);

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			cancel();
			panelDrag.dispose();
			groupDrag.dispose();
			ownerWindow.removeEventListener("pointerup", handlePointerUp);
			ownerWindow.removeEventListener("pointercancel", handlePointerCancel);
			ownerWindow.removeEventListener("blur", cancel);
			ownerDocument.removeEventListener(
				"visibilitychange",
				handleVisibilityChange,
			);
		},
	};
}
