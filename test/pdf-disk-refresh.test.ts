import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPlaceholderTab,
	type DocTab,
	refreshPdfTab,
} from "@/lib/workspace/tabs";

const readVaultFileMock = vi.hoisted(() => vi.fn());
const localFileToArrayBufferMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/vault", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/vault")>();
	return { ...actual, readVaultFile: readVaultFileMock };
});

vi.mock("@/lib/paper", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/paper")>();
	return { ...actual, localFileToArrayBuffer: localFileToArrayBufferMock };
});

vi.mock("@/lib/core/notify", () => ({
	notifyError: vi.fn(),
	notifyUndo: vi.fn(),
	notifyWarning: vi.fn(),
	notifySuccess: vi.fn(),
}));

// Import after the mocks: applyDiskChange reads through the mocked barrels.
import { applyDiskChange } from "@/lib/workspace/actions";

const PDF_PATH = "/Users/philfan/l/paper/plans/a.pdf";

function makePdfTab(path: string, overrides: Partial<DocTab> = {}): DocTab {
	return {
		...createPlaceholderTab(path, "pdf"),
		loaded: true,
		pdfBytes: new ArrayBuffer(8),
		...overrides,
	};
}

describe("refreshPdfTab", () => {
	it("swaps bytes for matching pdf and translation panes", () => {
		const oldBytes = new ArrayBuffer(8);
		const pdf = makePdfTab(PDF_PATH, { pdfBytes: oldBytes });
		const translation = {
			...makePdfTab(PDF_PATH, { pdfBytes: oldBytes }),
			mode: "translation" as const,
		};
		const otherBytes = new ArrayBuffer(8);
		const other = makePdfTab("/vault/other.pdf", { pdfBytes: otherBytes });

		const fresh = new ArrayBuffer(16);
		const next = refreshPdfTab([pdf, translation, other], PDF_PATH, fresh);

		expect(next[0]?.pdfBytes).toBe(fresh);
		expect(next[0]?.loaded).toBe(true);
		expect(next[1]?.pdfBytes).toBe(fresh);
		expect(next[2]?.pdfBytes).toBe(otherBytes);
	});

	it("leaves compile-shimmer panes to the compile flow", () => {
		const oldBytes = new ArrayBuffer(8);
		const tab = makePdfTab(PDF_PATH, {
			pdfBytes: oldBytes,
			texCompiling: true,
		});

		const next = refreshPdfTab([tab], PDF_PATH, new ArrayBuffer(16));

		expect(next[0]?.pdfBytes).toBe(oldBytes);
		expect(next[0]?.texCompiling).toBe(true);
	});
});

describe("applyDiskChange pdf panes", () => {
	beforeEach(() => {
		readVaultFileMock.mockReset();
		localFileToArrayBufferMock.mockReset();
	});

	it("re-reads the file and refreshes an open pdf pane", async () => {
		const tab = makePdfTab(PDF_PATH);
		const sink = {
			getTabs: () => [tab],
			refreshNotes: vi.fn(),
			refreshMarkdown: vi.fn(),
			refreshExcalidraw: vi.fn(),
			refreshText: vi.fn(),
			refreshPdf: vi.fn(),
		};
		const bytes = new ArrayBuffer(16);
		localFileToArrayBufferMock.mockResolvedValue(bytes);

		await applyDiskChange(PDF_PATH, sink);

		expect(localFileToArrayBufferMock).toHaveBeenCalledWith(PDF_PATH);
		expect(sink.refreshPdf).toHaveBeenCalledWith(PDF_PATH, bytes);
		// No text editor owns the path: no UTF-8 read should happen.
		expect(readVaultFileMock).not.toHaveBeenCalled();
	});

	it("keeps text reseeds working next to the pdf refresh", async () => {
		const tab = makePdfTab(PDF_PATH);
		const mdTab = {
			...createPlaceholderTab("/vault/notes.md", "markdown"),
			loaded: true,
		};
		const sink = {
			getTabs: () => [tab, mdTab],
			refreshNotes: vi.fn(),
			refreshMarkdown: vi.fn(),
			refreshExcalidraw: vi.fn(),
			refreshText: vi.fn(),
			refreshPdf: vi.fn(),
		};
		localFileToArrayBufferMock.mockResolvedValue(new ArrayBuffer(4));
		readVaultFileMock.mockResolvedValue("# fresh");

		await applyDiskChange(PDF_PATH, sink);

		expect(sink.refreshPdf).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the byte read fails", async () => {
		const tab = makePdfTab(PDF_PATH);
		const sink = {
			getTabs: () => [tab],
			refreshNotes: vi.fn(),
			refreshMarkdown: vi.fn(),
			refreshExcalidraw: vi.fn(),
			refreshText: vi.fn(),
			refreshPdf: vi.fn(),
		};
		localFileToArrayBufferMock.mockResolvedValue(null);

		await applyDiskChange(PDF_PATH, sink);

		expect(sink.refreshPdf).not.toHaveBeenCalled();
	});

	it("ignores changes while no pdf pane is open", async () => {
		const sink = {
			getTabs: () => [makePdfTab("/vault/other.pdf")],
			refreshNotes: vi.fn(),
			refreshMarkdown: vi.fn(),
			refreshExcalidraw: vi.fn(),
			refreshText: vi.fn(),
			refreshPdf: vi.fn(),
		};

		await applyDiskChange(PDF_PATH, sink);

		expect(localFileToArrayBufferMock).not.toHaveBeenCalled();
		expect(sink.refreshPdf).not.toHaveBeenCalled();
	});
});
