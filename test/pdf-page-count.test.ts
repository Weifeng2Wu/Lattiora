import { expect, it, vi } from "vitest";

const { doc, engine } = vi.hoisted(() => {
	const doc = { pageCount: 12 };
	return {
		doc,
		engine: {
			openDocumentBuffer: vi.fn(() => ({ toPromise: async () => doc })),
			closeDocument: vi.fn(() => ({ toPromise: async () => undefined })),
		},
	};
});
vi.mock("../src/lib/paper", () => ({
	findLocalPdfPath: async () => "paper.pdf",
	localFileToArrayBuffer: async () => new ArrayBuffer(4),
}));
vi.mock("../src/lib/pdf/layout/headless-analyze", () => ({
	getHeadlessPdfEngine: async () => engine,
}));
it("closes each lazily opened PDF after reading its page count", async () => {
	const { getPdfPageCount } = await import("../src/lib/pdf/page-count");
	expect(await getPdfPageCount("/cloud/papers/test")).toBe(12);
	expect(engine.closeDocument).toHaveBeenCalledWith(doc);
	doc.pageCount = 0;
	expect(await getPdfPageCount("/cloud/papers/test")).toBeNull();
	expect(engine.closeDocument).toHaveBeenCalledTimes(2);
});
