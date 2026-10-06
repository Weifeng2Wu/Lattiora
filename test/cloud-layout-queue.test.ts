import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	analyze: vi.fn(),
	read: vi.fn(),
	run: vi.fn(),
	unsubscribe: vi.fn(),
}));
vi.mock("../src/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../src/lib/cloud/db", () => ({
	cloudLock: (_key: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/lib/pdf/layout/headless-analyze", () => ({
	analyzePaperLayoutHeadless: mocks.analyze,
}));
vi.mock("../src/lib/pdf/layout/io", () => ({ readLayoutSidecar: mocks.read }));
vi.mock("../src/lib/pdf/layout/store", () => ({
	layoutAnalysisStore: { subscribe: () => mocks.unsubscribe },
}));
vi.mock("../src/lib/core/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../src/lib/core/tasks", () => ({ runLocalActivity: mocks.run }));
afterEach(() => {
	vi.resetAllMocks();
	vi.resetModules();
});
it("deduplicates automatic requests, forwards cancellation and skips the persisted result", async () => {
	const signal = new AbortController().signal;
	mocks.run.mockImplementation((_input, fn) => fn({ id: "test", signal }));
	mocks.read.mockResolvedValue(null);
	let finish!: () => void;
	mocks.analyze.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const { enqueuePaperLayoutAnalysis } = await import(
		"../src/lib/pdf/layout/enqueue-paper-layout"
	);
	const first = enqueuePaperLayoutAnalysis({
		paperAbsPath: "/cloud/papers/test",
	});
	const second = enqueuePaperLayoutAnalysis({
		paperAbsPath: "/cloud/papers/test",
	});
	expect(first).toBe(second);
	await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce());
	expect(mocks.analyze.mock.calls[0][0].signal).toBe(signal);
	finish();
	await first;
	expect(mocks.unsubscribe).toHaveBeenCalledOnce();
	mocks.read.mockResolvedValue({ regions: [{}] });
	await enqueuePaperLayoutAnalysis({ paperAbsPath: "/cloud/papers/test" });
	expect(mocks.analyze).toHaveBeenCalledOnce();
});
it("a failed run releases deduplication and subscriptions so a later request can retry", async () => {
	mocks.run.mockImplementation((_input, fn) =>
		fn({ id: "test", signal: new AbortController().signal }),
	);
	mocks.read.mockResolvedValue(null);
	mocks.analyze
		.mockRejectedValueOnce(new Error("providerError"))
		.mockResolvedValueOnce({ regionCount: 1 });
	const { enqueuePaperLayoutAnalysis } = await import(
		"../src/lib/pdf/layout/enqueue-paper-layout"
	);
	await enqueuePaperLayoutAnalysis({ paperAbsPath: "/cloud/papers/retry" });
	await enqueuePaperLayoutAnalysis({ paperAbsPath: "/cloud/papers/retry" });
	expect(mocks.analyze).toHaveBeenCalledTimes(2);
	expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
});
