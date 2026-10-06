import { describe, expect, it } from "vitest";
import {
	imageMimeFromPath,
	isExcalidrawPath,
	isHtmlPath,
	isImagePath,
	isImageViewerSource,
	isPdfPath,
	preferredModeForPath,
	textLanguageIdForPath,
} from "@/lib/workspace/viewer";

describe("viewer path helpers", () => {
	it("detects pdf / html / image extensions", () => {
		expect(isPdfPath("/vault/a.PDF")).toBe(true);
		expect(isHtmlPath("/vault/page.htm")).toBe(true);
		expect(isImagePath("/vault/fig.png")).toBe(true);
		expect(isImagePath("/vault/fig.JPEG")).toBe(true);
		expect(isImagePath("/vault/logo.svg")).toBe(true);
		expect(isImagePath("/vault/notes.md")).toBe(false);
	});

	it("maps image mime from extension", () => {
		expect(imageMimeFromPath("x.png")).toBe("image/png");
		expect(imageMimeFromPath("x.jpg")).toBe("image/jpeg");
		expect(imageMimeFromPath("x.svg")).toBe("image/svg+xml");
		expect(imageMimeFromPath("x.webp")).toBe("image/webp");
	});

	it("preferredModeForPath prefers media over markdown", () => {
		expect(preferredModeForPath("/a/b.pdf")).toBe("pdf");
		expect(preferredModeForPath("/a/b.html")).toBe("html");
		expect(preferredModeForPath("/a/b.png")).toBe("image");
		expect(preferredModeForPath("/a/b.excalidraw")).toBe("excalidraw");
		expect(preferredModeForPath("/a/b.md")).toBe("markdown");
		expect(preferredModeForPath(null)).toBe("markdown");
	});

	it("falls back to the text editor only outside papers/", () => {
		expect(preferredModeForPath("/vault/notes/config.toml")).toBe("text");
		expect(preferredModeForPath("/vault/README")).toBe("text");
		expect(preferredModeForPath("/vault/notes/data.json")).toBe("text");
		// Notes and other paper internals keep their original mode.
		expect(preferredModeForPath("/vault/papers/2401.0001/notes/org.md")).toBe(
			"markdown",
		);
		expect(preferredModeForPath("/vault/papers/2401.0001/data/misc.dat")).toBe(
			"markdown",
		);
		// Dedicated viewers still win under papers/.
		expect(preferredModeForPath("/vault/papers/2401.0001/main.pdf")).toBe(
			"pdf",
		);
	});

	it("opens downloaded TeX source as plain text without Markdown conversion", () => {
		expect(
			preferredModeForPath("/cloud/papers/2501.00001/source/main.tex"),
		).toBe("text");
		expect(
			preferredModeForPath("/cloud/papers/2501.00001/source/refs.bib"),
		).toBe("text");
		expect(
			preferredModeForPath("/cloud/papers/2501.00001/source/fig.pdf"),
		).toBe("pdf");
		expect(preferredModeForPath("/cloud/papers/2501.00001/NOTES.md")).toBe(
			"markdown",
		);
	});

	it("maps text editor languages from extensions", () => {
		expect(textLanguageIdForPath("/a/config.json")).toBe("json");
		expect(textLanguageIdForPath("/a/ci.YML")).toBe("yaml");
		expect(textLanguageIdForPath("/a/main.py")).toBe("python");
		expect(textLanguageIdForPath("/a/main.tex")).toBe("tex");
		expect(textLanguageIdForPath("/a/ref.bib")).toBe("bib");
		expect(textLanguageIdForPath("/a/notes.txt")).toBe(null);
		expect(textLanguageIdForPath("/a/README")).toBe(null);
	});

	it("detects excalidraw extensions", () => {
		expect(isExcalidrawPath("/vault/drawing.excalidraw")).toBe(true);
		expect(isExcalidrawPath("/vault/drawing.EXCALIDRAW")).toBe(true);
		expect(isExcalidrawPath("/vault/drawing.json")).toBe(false);
	});

	it("accepts blob and data URLs as image sources", () => {
		expect(isImageViewerSource("blob:http://localhost/1")).toBe(true);
		expect(isImageViewerSource("https://example.com/a.png")).toBe(true);
		expect(isImageViewerSource("data:image/png;base64,aa")).toBe(true);
		expect(isImageViewerSource("asset://localhost/a.png")).toBe(false);
		expect(isImageViewerSource(null)).toBe(false);
	});
});
