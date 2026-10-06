import type { PdfDocumentObject, PdfEngine } from "@embedpdf/models";
import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/core/notify";

/** Isolated PDFium preview: no workspace providers, filesystem or settings. */
export default function SharedPdfPreview({ url }: { url: string }) {
	const { t } = useTranslation("editor");
	const [resource, setResource] = useState<{
		engine: PdfEngine;
		doc: PdfDocumentObject;
	} | null>(null);
	const [page, setPage] = useState(0);
	const [image, setImage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		let engine: PdfEngine | undefined;
		setResource(null);
		setFailed(false);
		setPage(0);
		void (async () => {
			const { createPdfiumEngine } = await import(
				"@embedpdf/engines/pdfium-worker-engine"
			);
			const content = await (await fetch(url)).arrayBuffer();
			if (!active) return;
			engine = createPdfiumEngine(
				new URL(pdfiumWasmUrl, document.baseURI).href,
			);
			const doc = await engine
				.openDocumentBuffer({ id: crypto.randomUUID(), content })
				.toPromise();
			if (active) setResource({ engine, doc });
		})().catch(() => {
			if (active) {
				setFailed(true);
				notifyError(t("share.previewFailed"));
			}
		});
		return () => {
			active = false;
			engine
				?.destroy?.()
				.toPromise()
				.catch(() => undefined);
		};
	}, [url, t]);
	useEffect(() => {
		setImage(null);
		if (!resource) return;
		let active = true;
		let objectUrl: string | undefined;
		const current = resource.doc.pages[page];
		if (!current) {
			setFailed(true);
			notifyError(t("share.previewFailed"));
			return;
		}
		void resource.engine
			.renderPageRect(
				resource.doc,
				current,
				{ origin: { x: 0, y: 0 }, size: current.size },
				{
					scaleFactor: Math.min(
						2,
						1800 / Math.max(current.size.width, current.size.height),
					),
					imageType: "image/png",
					withAnnotations: false,
					withForms: false,
				},
			)
			.toPromise()
			.then((blob) => {
				if (!active) return;
				objectUrl = URL.createObjectURL(blob);
				setImage(objectUrl);
			})
			.catch(() => {
				if (active) {
					setFailed(true);
					notifyError(t("share.previewFailed"));
				}
			});
		return () => {
			active = false;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [resource, page, t]);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{resource && resource.doc.pageCount > 1 && (
				<div className="flex shrink-0 items-center justify-center gap-3 border-b p-2">
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={t("share.previousPage")}
						disabled={!image || page === 0}
						onClick={() => setPage((value) => value - 1)}
					>
						<ChevronLeft />
					</Button>
					<span className="text-sm tabular-nums">
						{t("share.page", { page: page + 1, count: resource.doc.pageCount })}
					</span>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={t("share.nextPage")}
						disabled={!image || page + 1 === resource.doc.pageCount}
						onClick={() => setPage((value) => value + 1)}
					>
						<ChevronRight />
					</Button>
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3">
				{failed ? (
					<p className="p-6 text-center text-sm">{t("share.previewFailed")}</p>
				) : image && resource ? (
					<img
						src={image}
						alt={t("share.page", {
							page: page + 1,
							count: resource.doc.pageCount,
						})}
						className="mx-auto h-auto max-w-full shadow-sm"
					/>
				) : (
					<p role="status" className="p-6 text-center text-sm">
						{t("share.loading")}
					</p>
				)}
			</div>
		</div>
	);
}
