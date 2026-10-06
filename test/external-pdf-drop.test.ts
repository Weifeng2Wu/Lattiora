import { describe, expect, it } from "vitest";
import { dataTransferLooksLikeOsFiles } from "@/lib/core/file-accept";
import { VAULT_FILE_DRAG_TYPE } from "@/lib/core/vault-file-drag";
import { pdfsFromPaths } from "@/lib/shell/external-file-drop";
import { handleExternalPdfDrop } from "@/lib/shell/external-pdf-drop";

function dropEvent(opts: {
	types: string[];
	file?: { name: string; type: string; path?: string };
}): DragEvent & { defaultPrevented: boolean } {
	const file = opts.file
		? ({
				...opts.file,
				size: 1,
				lastModified: 1,
				arrayBuffer: async () => new ArrayBuffer(0),
			} as unknown as File)
		: null;
	const dataTransfer = {
		types: opts.types,
		items: { length: 0 },
		files: {
			length: file ? 1 : 0,
			item: (index: number) => (index === 0 ? file : null),
			*[Symbol.iterator]() {
				if (file) yield file;
			},
		},
		getData: () => "",
	} as unknown as DataTransfer;
	let defaultPrevented = false;
	return {
		dataTransfer,
		get defaultPrevented() {
			return defaultPrevented;
		},
		preventDefault() {
			defaultPrevented = true;
		},
	} as DragEvent & { defaultPrevented: boolean };
}

describe("handleExternalPdfDrop", () => {
	it("imports a PDF dropped on an unhandled surface such as the reader", async () => {
		const event = dropEvent({
			types: ["Files"],
			file: {
				name: "reader-drop.pdf",
				type: "application/pdf",
				path: "/tmp/reader-drop.pdf",
			},
		});
		const imported = new Promise<unknown[]>((resolve) => {
			handleExternalPdfDrop(event, {
				onImport: resolve,
			});
		});

		expect(event.defaultPrevented).toBe(true);
		expect(await imported).toEqual([
			{
				path: "/tmp/reader-drop.pdf",
				sourceName: "reader-drop.pdf",
			},
		]);
	});

	it("still routes a PDF when Dockview only canceled the browser default", async () => {
		const event = dropEvent({
			types: ["Files"],
			file: {
				name: "dockview-drop.pdf",
				type: "application/pdf",
				path: "/tmp/dockview-drop.pdf",
			},
		});
		event.preventDefault();
		const imported = new Promise<unknown[]>((resolve) => {
			handleExternalPdfDrop(event, { onImport: resolve });
		});

		expect(await imported).toEqual([
			{
				path: "/tmp/dockview-drop.pdf",
				sourceName: "dockview-drop.pdf",
			},
		]);
	});

	it("recognizes a PDF when the WebView exposes only File.path", async () => {
		const event = dropEvent({
			types: ["Files"],
			file: { name: "", type: "", path: "/tmp/path-only.pdf" },
		});
		const imported = new Promise<unknown[]>((resolve) => {
			handleExternalPdfDrop(event, { onImport: resolve });
		});

		expect(await imported).toEqual([
			{ path: "/tmp/path-only.pdf", sourceName: "path-only.pdf" },
		]);
	});

	it("recognizes a PDF from a FileList even when types and items are empty", () => {
		const event = dropEvent({
			types: [],
			file: { name: "file-list-only.pdf", type: "application/pdf" },
		});

		expect(dataTransferLooksLikeOsFiles(event.dataTransfer)).toBe(true);
	});

	it("normalizes and deduplicates native PDF paths", () => {
		expect(
			pdfsFromPaths([
				"C:\\papers\\reader-drop.pdf",
				"C:/papers/reader-drop.pdf",
				"file:///C:/papers/reader-drop.pdf",
				"C:/papers/notes.md",
			]),
		).toEqual([
			{ path: "C:/papers/reader-drop.pdf", sourceName: "reader-drop.pdf" },
		]);
	});

	it("does not claim an internal vault drag", () => {
		const event = dropEvent({
			types: [VAULT_FILE_DRAG_TYPE, "text/plain"],
		});

		expect(
			handleExternalPdfDrop(event, {
				onImport: () => undefined,
			}),
		).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});

	it("ignores non-PDF external files", () => {
		const event = dropEvent({
			types: ["Files"],
			file: { name: "notes.md", type: "text/markdown" },
		});

		expect(
			handleExternalPdfDrop(event, {
				onImport: () => undefined,
			}),
		).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});
});
