/**
 * EmbedPDF document ids for local PDF buffers.
 *
 * The workspace shares one PDFium engine across every tab, and the engine
 * caches documents by id. A reload (TeX recompile / external overwrite) only
 * swaps the buffer while the id stays the stable tab id. The old document is
 * closed *after* the replacement open is queued — EmbedPDF's registry destroy
 * is async, and the worker queue ranks `openDocumentBuffer` above
 * `closeDocument` — so reusing the id makes the engine re-use the stale
 * PDFium document and silently drop the new bytes. Fold a per-buffer revision
 * into the id so each re-read from disk registers a fresh document.
 */

const revisions = new WeakMap<ArrayBuffer, number>();
let revisionSeq = 0;

/** `baseDocId` for URL sources, `baseDocId::r<n>` for buffer-backed ones. */
export function embedPdfDocumentId(
	baseDocId: string,
	sourceBytes: ArrayBuffer | null | undefined,
): string {
	if (!sourceBytes) return baseDocId;
	let revision = revisions.get(sourceBytes);
	if (revision === undefined) {
		revision = ++revisionSeq;
		revisions.set(sourceBytes, revision);
	}
	return `${baseDocId}::r${revision}`;
}

/**
 * Remove the trailing per-buffer revision (`base::r<n>` → `base`). Single
 * layer: never stack calls — a base id that legitimately ends in `::r<digits>`
 * (a path is allowed to contain `::`) would be over-stripped. Cross-module
 * state keys (layout store, scroll-sync pairs) use the stripped base id so
 * writer and reader agree regardless of which buffer revision each viewer
 * mounted; the engine itself keeps the full id.
 */
export function stripEmbedPdfRevision(id: string): string {
	return id.replace(/::r\d+$/, "");
}
