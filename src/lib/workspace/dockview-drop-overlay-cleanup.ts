/**
 * Dockview's HTML5 drop overlay can stick when a drag that entered the
 * workspace leaves it without a matching `dragleave` target (dragenter may
 * latch on a child element while dragleave fires on the container). This
 * watches the workspace root and clears any visible drop indicators when the
 * drag ends or exits the workspace.
 */

const DROP_OVERLAY_SELECTORS = [
	".dv-drop-target-dropzone",
	".dv-drop-target-container",
	".dv-drop-target-anchor",
	".dv-drop-target-edge",
] as const;

function clearDropOverlays(root: HTMLElement): void {
	for (const selector of DROP_OVERLAY_SELECTORS) {
		for (const el of root.querySelectorAll(selector)) {
			if (selector === ".dv-drop-target-dropzone") {
				el.parentElement?.classList.remove("dv-drop-target");
			}
			el.remove();
		}
	}
	for (const el of root.querySelectorAll(".dv-drop-target")) {
		el.classList.remove("dv-drop-target");
	}
}

export function installDockviewDropOverlayCleanup(root: HTMLElement): {
	dispose: () => void;
} {
	const ownerDocument = root.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	if (!ownerWindow) return { dispose() {} };

	let disposed = false;

	const handleDragEnd = () => {
		if (disposed) return;
		clearDropOverlays(root);
	};

	const handleDragLeave = (event: DragEvent) => {
		if (disposed) return;
		const related = event.relatedTarget as Node | null;
		if (!related || !root.contains(related)) {
			clearDropOverlays(root);
		}
	};

	ownerWindow.addEventListener("dragend", handleDragEnd, true);
	root.addEventListener("dragleave", handleDragLeave);

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			ownerWindow.removeEventListener("dragend", handleDragEnd, true);
			root.removeEventListener("dragleave", handleDragLeave);
		},
	};
}
