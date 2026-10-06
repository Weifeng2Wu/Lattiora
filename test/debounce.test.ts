import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "@/lib/core/debounce";

describe("debounce", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("invokes once with the latest args after the quiet window", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced("a");
		debounced("b");
		debounced("c");
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(99);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledOnce();
		expect(fn).toHaveBeenCalledWith("c");
	});

	it("restarts the timer on every call", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced(1);
		vi.advanceTimersByTime(80);
		debounced(2);
		vi.advanceTimersByTime(80);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(20);
		expect(fn).toHaveBeenCalledOnce();
		expect(fn).toHaveBeenCalledWith(2);
	});

	it("cancel drops the pending invocation", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced("x");
		debounced.cancel();
		vi.advanceTimersByTime(500);
		expect(fn).not.toHaveBeenCalled();
		// The debouncer stays usable after a cancel.
		debounced("y");
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledOnce();
		expect(fn).toHaveBeenCalledWith("y");
	});

	it("flush runs the pending invocation immediately", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced("x");
		debounced.flush();
		expect(fn).toHaveBeenCalledOnce();
		expect(fn).toHaveBeenCalledWith("x");
		// Nothing fires twice after a flush.
		vi.advanceTimersByTime(500);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("flush is a no-op when nothing is pending", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced.flush();
		debounced("x");
		debounced.cancel();
		debounced.flush();
		expect(fn).not.toHaveBeenCalled();
	});

	it("supports a reentrant call from inside the invocation", () => {
		const fn = vi.fn(() => {
			if (fn.mock.calls.length === 1) debounced("second");
		});
		const debounced = debounce(fn, 100);
		debounced("first");
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith("second");
	});
});
