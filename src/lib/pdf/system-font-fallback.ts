import type { FontFallbackConfig } from "@embedpdf/engines/pdfium";

/**
 * Load one local CJK font for PDFium's missing-font callback.
 *
 * PDFium runs in a WASM context (and usually a Web Worker), so CSS system
 * fonts are not visible to it. The Host locates a displayable system CJK font;
 * this exposes its bytes as a local blob URL that both direct and worker
 * PDFium engines can fetch without a network request.
 */
export function loadSystemCjkFontFallback(): Promise<FontFallbackConfig | null> {
	return Promise.resolve(null);
}
