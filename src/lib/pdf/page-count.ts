/** Read page count lazily without loading a layout model or keeping the PDF open. */
import { findLocalPdfPath, localFileToArrayBuffer } from "@/lib/paper";
import { getHeadlessPdfEngine } from "@/lib/pdf/layout/headless-analyze";

export async function getPdfPageCount(
	paperAbsPath: string,
): Promise<number | null> {
	try {
		const pdfPath = await findLocalPdfPath(paperAbsPath);
		if (!pdfPath) return null;
		const buffer = await localFileToArrayBuffer(pdfPath);
		if (!buffer) return null;
		const engine = await getHeadlessPdfEngine();
		const doc = await engine
			.openDocumentBuffer({
				id: `page-count-${crypto.randomUUID()}`,
				content: buffer,
			})
			.toPromise();
		try {
			return doc.pageCount > 0 ? doc.pageCount : null;
		} finally {
			await engine.closeDocument(doc).toPromise();
		}
	} catch {
		return null;
	}
}
