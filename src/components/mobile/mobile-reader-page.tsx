import { LoaderCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MobileReaderMode } from "@/components/mobile/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import i18n from "@/i18n";
import { cloudAiError } from "@/lib/cloud/ai";
import { openCloudPaper } from "@/lib/cloud/catalog";
import {
	absoluteCloudPath,
	readLocalFile,
	writeLocalFile,
} from "@/lib/cloud/files";
import { notifyError } from "@/lib/core/notify";

import type { PaperMetadata } from "@/lib/paper/types";

const MobilePdfViewer = lazy(() =>
	import("@/components/viewer/pdf/pdf-viewer").then((module) => ({
		default: module.PdfViewer,
	})),
);

export function MobileReaderPage({
	paper,
	mode,
	beforeLeave,
}: {
	paper: PaperMetadata;
	mode: MobileReaderMode;
	beforeLeave: { current: (() => Promise<boolean>) | null };
}) {
	const { t } = useTranslation("mobile");
	const [notes, setNotes] = useState("");
	const [saving, setSaving] = useState(false);
	const pdfSource = null;
	const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
	const [pdfError, setPdfError] = useState<string | null>(null);

	const original = useRef<string | null>(null);
	const current = useRef(notes);
	current.current = notes;
	useEffect(() => {
		let active = true;
		if (!paper.path) return;
		void openCloudPaper(paper.path)
			.then(async (bundle) => {
				if (!active) return;
				original.current = bundle.notesSeed ?? "";
				setNotes(bundle.notesSeed ?? "");
				if (!bundle.pdfPath) {
					setPdfError(i18n.t("mobile:reader.pdfUnavailable"));
					return;
				}
				const bytes = await (await readLocalFile(bundle.pdfPath)).arrayBuffer();
				if (active) setPdfBytes(bytes);
			})
			.catch((error) => {
				if (active) {
					setPdfError(cloudAiError(error));
					notifyError(cloudAiError(error));
				}
			});
		return () => {
			active = false;
		};
	}, [paper.path]);
	const savingRef = useRef<Promise<boolean> | null>(null);
	const save = (): Promise<boolean> => {
		if (savingRef.current) return savingRef.current;
		if (!paper.path || original.current === null) return Promise.resolve(true);
		if (current.current === original.current) return Promise.resolve(true);
		const text = current.current;
		setSaving(true);
		const operation = writeLocalFile(
			`${paper.path}/NOTES.md`,
			new Blob([text], { type: "text/markdown" }),
			{ expectedText: original.current, preserveConflict: true },
		)
			.then(() => {
				original.current = text;
				return true;
			})
			.catch((error) => {
				notifyError(cloudAiError(error));
				return false;
			})
			.finally(() => {
				savingRef.current = null;
				setSaving(false);
			});
		savingRef.current = operation;
		return operation;
	};
	useEffect(() => {
		beforeLeave.current = save;
	});
	useEffect(() => {
		const preventLoss = (event: BeforeUnloadEvent) => {
			if (original.current !== null && current.current !== original.current) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", preventLoss);
		return () => {
			beforeLeave.current = null;
			window.removeEventListener("beforeunload", preventLoss);
		};
	}, [beforeLeave]);
	const pdf = (
		<MobilePdfPreview
			source={pdfSource}
			bytes={pdfBytes}
			error={pdfError}
			docId={`mobile:${paper.id}`}
			paperPath={paper.path ?? null}
			active={mode === "pdf"}
		/>
	);
	const notesEditor = (
		<div className="relative flex h-full min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto pb-20">
				<Textarea
					value={notes}
					disabled={saving || original.current === null}
					aria-label={t("reader.notes")}
					onChange={(event) => setNotes(event.target.value)}
					className="min-h-full w-full resize-none overflow-y-auto rounded-none border-0 p-4 font-mono text-base leading-6 shadow-none field-sizing-fixed focus-visible:ring-0 md:px-6 md:text-base"
				/>
			</div>
			<footer className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end border-t bg-background/95 px-4 py-3 backdrop-blur md:px-6">
				<Button
					size="sm"
					className="pointer-events-auto"
					disabled={saving || original.current === null}
					onClick={() => void save()}
				>
					{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
					{saving ? t("reader.saving") : t("reader.save")}
				</Button>
			</footer>
		</div>
	);
	return (
		<section className="grid h-full min-h-0 grid-cols-1 md:grid-cols-2 md:divide-x">
			<div
				className={`h-full min-h-0 ${mode === "notes" ? "max-md:hidden" : ""}`}
			>
				{pdf}
			</div>
			<div
				className={`h-full min-h-0 ${mode === "pdf" ? "max-md:hidden" : ""}`}
			>
				{notesEditor}
			</div>
		</section>
	);
}

function MobilePdfPreview({
	source,
	bytes,
	error,
	docId,
	paperPath,
	active,
}: {
	source: string | null;
	bytes: ArrayBuffer | null;
	error: string | null;
	docId: string;
	paperPath: string | null;
	active: boolean;
}) {
	const { t } = useTranslation("mobile");
	if (error) {
		return (
			<div className="grid h-full place-items-center p-6 text-center text-muted-foreground text-sm">
				{error || t("reader.pdfUnavailable")}
			</div>
		);
	}
	if (!source && !bytes) {
		return (
			<div className="grid h-full place-items-center gap-2 text-muted-foreground text-sm">
				<LoaderCircle className="size-5 animate-spin" />
				{t("reader.loadingPdf")}
			</div>
		);
	}
	return (
		<div className="h-full min-h-0">
			<Suspense
				fallback={
					<div className="grid h-full place-items-center">
						<LoaderCircle className="size-5 animate-spin text-muted-foreground" />
					</div>
				}
			>
				<MobilePdfViewer
					source={source}
					sourceBytes={bytes}
					docId={docId}
					paperRelPath={paperPath}
					paperAbsPath={paperPath ? absoluteCloudPath(paperPath) : null}
					className="h-full"
					isActive={active}
				/>
			</Suspense>
		</div>
	);
}
