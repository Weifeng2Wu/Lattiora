import { describe, expect, it } from "vitest";
import { mapLimit } from "@/lib/core/utils";

describe("mapLimit", () => {
	it("returns results in input order", async () => {
		const result = await mapLimit([3, 1, 2], 2, async (n) => n * 2);
		expect(result).toEqual([6, 2, 4]);
	});

	it("limits concurrent executions", async () => {
		let running = 0;
		let maxRunning = 0;
		const delays = [50, 30, 10];

		await mapLimit(delays, 2, async (ms) => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((resolve) => setTimeout(resolve, ms));
			running--;
			return ms;
		});

		expect(maxRunning).toBe(2);
		expect(running).toBe(0);
	});

	it("handles an empty array", async () => {
		const result = await mapLimit<number, number>([], 2, async (n) => n);
		expect(result).toEqual([]);
	});

	it("handles concurrency larger than array length", async () => {
		const result = await mapLimit([1], 5, async (n) => n * 10);
		expect(result).toEqual([10]);
	});

	it("rejects when any item rejects", async () => {
		await expect(
			mapLimit([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error("boom");
				return n;
			}),
		).rejects.toThrow("boom");
	});
});
