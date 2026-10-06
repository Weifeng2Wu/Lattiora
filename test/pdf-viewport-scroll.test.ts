import { describe, expect, it, vi } from "vitest";
import { createPdfViewportScrollScheduler } from "@/lib/pdf/viewport-scroll";

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

describe("PDF viewport scroll scheduler", () => {
	it("drops a deferred page jump when native scrolling starts first", () => {
		const frames = frameHarness();
		const apply = vi.fn();
		const scheduler = createPdfViewportScrollScheduler({
			apply,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		scheduler.schedule({ x: 0, y: 0, behavior: "instant" });
		// This is the native viewport scroll event produced by the user's wheel.
		scheduler.cancelPending();
		frames.flush();

		expect(apply).not.toHaveBeenCalled();
	});

	it("coalesces several same-frame requests to the latest target", () => {
		const frames = frameHarness();
		const apply = vi.fn();
		const scheduler = createPdfViewportScrollScheduler({
			apply,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		scheduler.schedule({ x: 10, y: 100, behavior: "instant" });
		scheduler.schedule({ x: 20, y: 200, behavior: "instant" });
		frames.flush();

		expect(apply).toHaveBeenCalledTimes(1);
		expect(apply).toHaveBeenCalledWith({
			x: 20,
			y: 200,
			behavior: "instant",
		});

		// A virtual-page reorder, zoom relayout, or synchronized pane may emit
		// another programmatic target after the previous target was applied;
		// later requests must remain schedulable.
		scheduler.schedule({ x: 30, y: 300, behavior: "instant" });
		frames.flush();

		expect(apply).toHaveBeenLastCalledWith({
			x: 30,
			y: 300,
			behavior: "instant",
		});
	});
});
