import { describe, expect, it, vi } from "vitest";
import { createPdfViewportResizeGate } from "@/lib/pdf/dockview-resize";

function frameHarness() {
	let callback: FrameRequestCallback | null = null;
	return {
		requestFrame: vi.fn((next: FrameRequestCallback) => {
			callback = next;
			return 7;
		}),
		cancelFrame: vi.fn(() => {
			callback = null;
		}),
		flush: () => {
			const next = callback;
			callback = null;
			next?.(0);
		},
	};
}

describe("PDF viewport during Dockview resize", () => {
	it("coalesces ordinary resize notifications to one animation frame", () => {
		const frames = frameHarness();
		const commitResize = vi.fn();
		const gate = createPdfViewportResizeGate({
			commitResize,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		gate.notifyResize();
		gate.notifyResize();
		gate.notifyResize();
		expect(frames.requestFrame).toHaveBeenCalledTimes(1);

		frames.flush();
		expect(commitResize).toHaveBeenCalledTimes(1);
	});

	it("suppresses drag-time work and commits the final size once", () => {
		const frames = frameHarness();
		const commitResize = vi.fn();
		const gate = createPdfViewportResizeGate({
			commitResize,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		gate.notifyResize();
		gate.beginDockResize();
		expect(frames.cancelFrame).toHaveBeenCalledWith(7);

		gate.notifyResize();
		gate.notifyResize();
		expect(frames.requestFrame).toHaveBeenCalledTimes(1);

		gate.endDockResize();
		expect(frames.requestFrame).toHaveBeenCalledTimes(2);
		frames.flush();
		expect(commitResize).toHaveBeenCalledTimes(1);

		gate.dispose();
		gate.notifyResize();
		expect(frames.requestFrame).toHaveBeenCalledTimes(2);
	});
});
