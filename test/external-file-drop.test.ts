import { describe, expect, it } from "vitest";
import {
	dataTransferHasFiles,
	isImportTempPath,
	isPdfFileName,
	pathsFromDataTransfer,
	pdfPathsFromDataTransfer,
} from "@/lib/shell/external-file-drop";

function mockDt(opts: {
	types?: string[];
	data?: Record<string, string>;
	files?: Array<{ path?: string; name?: string; type?: string }>;
}): DataTransfer {
	const types = opts.types ?? [];
	const data = opts.data ?? {};
	const files = opts.files ?? [];
	return {
		types,
		getData: (t: string) => data[t] ?? "",
		files: {
			length: files.length,
			item: (i: number) => files[i] as unknown as File,
			*[Symbol.iterator]() {
				for (const f of files) yield f as unknown as File;
			},
		},
	} as unknown as DataTransfer;
}

describe("external-file-drop", () => {
	it("detects OS file payloads", () => {
		expect(dataTransferHasFiles(mockDt({ types: ["Files"] }))).toBe(true);
		expect(dataTransferHasFiles(mockDt({ types: ["text/plain"] }))).toBe(false);
	});

	it("reads absolute paths from File.path", () => {
		const dt = mockDt({
			types: ["Files"],
			files: [{ path: "/Users/me/paper.pdf", name: "paper.pdf" }],
		});
		expect(pathsFromDataTransfer(dt)).toEqual(["/Users/me/paper.pdf"]);
		expect(pdfPathsFromDataTransfer(dt)).toEqual(["/Users/me/paper.pdf"]);
	});

	it("parses file:// uri-list and filters non-PDF", () => {
		const dt = mockDt({
			types: ["Files", "text/uri-list"],
			data: {
				"text/uri-list":
					"file:///Users/me/a.pdf\n#comment\nfile:///Users/me/note.md\n",
			},
		});
		expect(pathsFromDataTransfer(dt)).toEqual([
			"/Users/me/a.pdf",
			"/Users/me/note.md",
		]);
		expect(pdfPathsFromDataTransfer(dt)).toEqual(["/Users/me/a.pdf"]);
	});

	it("normalizes Windows file:// paths", () => {
		const dt = mockDt({
			types: ["text/uri-list"],
			data: { "text/uri-list": "file:///C:/Users/me/x.PDF" },
		});
		expect(pdfPathsFromDataTransfer(dt)).toEqual(["C:/Users/me/x.PDF"]);
	});

	it("dedupes the same Windows file across backslash and file:// forms", () => {
		const dt = mockDt({
			types: ["Files", "text/uri-list"],
			files: [{ path: "C:\\Users\\me\\x.pdf", name: "x.pdf" }],
			data: { "text/uri-list": "file:///C:/Users/me/x.pdf" },
		});
		expect(pathsFromDataTransfer(dt)).toEqual(["C:/Users/me/x.pdf"]);
	});

	it("ignores http URLs", () => {
		const dt = mockDt({
			types: ["text/uri-list"],
			data: { "text/uri-list": "https://example.com/a.pdf" },
		});
		expect(pathsFromDataTransfer(dt)).toEqual([]);
	});

	it("isPdfFileName and isImportTempPath", () => {
		expect(isPdfFileName("a.pdf")).toBe(true);
		expect(isPdfFileName("a.PDF")).toBe(true);
		expect(isPdfFileName("a.md")).toBe(false);
		expect(isImportTempPath("/Users/me/.agentero/import-tmp/1-x.pdf")).toBe(
			true,
		);
		expect(isImportTempPath("/Users/me/Desktop/x.pdf")).toBe(false);
	});
});
