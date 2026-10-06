import { expect, it } from "vitest";
import { parseExcalidrawDocument } from "../src/lib/workspace/excalidraw-document";

it("keeps embedded image data when reopening a drawing", () => {
	const drawing = {
		type: "excalidraw",
		version: 2,
		elements: [{ id: "image", type: "image", fileId: "binary" }],
		appState: { viewBackgroundColor: "#fff" },
		files: {
			binary: {
				id: "binary",
				dataURL: "data:image/png;base64,AA==",
				mimeType: "image/png",
				created: 1,
			},
		},
	};
	expect(parseExcalidrawDocument(JSON.stringify(drawing))).toEqual({
		elements: drawing.elements,
		appState: drawing.appState,
		files: drawing.files,
	});
});
it("never repairs invalid or future documents by replacing them with a blank canvas", () => {
	for (const seed of [
		"{",
		"null",
		"{}",
		'{"type":"excalidraw","version":3,"elements":[]}',
		'{"type":"excalidraw","version":2,"elements":[null]}',
	])
		expect(() => parseExcalidrawDocument(seed)).toThrow();
	expect(parseExcalidrawDocument("").elements).toEqual([]);
});
