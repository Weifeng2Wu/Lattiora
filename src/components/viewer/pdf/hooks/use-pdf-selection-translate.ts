/**
 * Selection → 翻译 workflow for the EmbedPDF viewer: the one ephemeral mark kind.
 * A translate card is created straight from the selection menu and streams into
 * the open card. It never auto-closes — the reader dismisses it explicitly
 * (hide / delete), so this cluster owns the whole run lifecycle
 * (`translateStreaming`, its cancel token, its error chrome) plus the record
 * write to `marks/<id>.json`.
 *
 * Its own hook for the record container and card chrome around one run: the
 * two providers behind the UI contract (an ACP Agent streamed through the
 * three agent listeners, cancellable; a plain translate provider, single
 * await) execute in the shared engine {@link runSelectionTranslate}, which
 * funnels back through `upsertTranslate` / `persistTranslate` /
 * `markTranslateFailure`, and nothing outside translate touches them.
 *
 * Boundaries:
 * - the persisted array lives in {@link usePdfMarksIo}: setters and the mirror
 *   ref are injected, never re-declared here;
 * - card placement / hover lives in {@link usePdfCards}: this hook only opens
 *   and hides its own card;
 * - `activeSessionRef` is shared with the ask cluster (at most one PDF agent run
 *   is in flight), so the parent owns it and injects it into both;
 * - the selection menu owns its own teardown, so the parent closes the menu and
 *   hands this hook the anchor.
 */

import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { PdfViewerProps } from "@/components/viewer/pdf/types";
import { cancelAgentRun, disposeAgentRun } from "@/lib/agent";
import type { UnlistenFn } from "@/lib/core/browser-events";
import type { PdfAskAnchor } from "@/lib/pdf/ask/types";
import type { ActiveSelectionCard } from "@/lib/pdf/selection";
import {
	createTranslateRecord,
	deletePdfTranslate,
	runSelectionTranslate,
	writePdfTranslate,
} from "@/lib/pdf/translate";
import type { PdfTranslateRecord } from "@/lib/pdf/translate/types";

export type UsePdfSelectionTranslateOptions = {
	/** Sidecar root for `marks/<id>.json` (null for loose PDFs — nothing persists). */
	paperAbsPath: string | null;
	/** Vault-relative provenance stamped into the record. */
	paperRelPath: string | null;
	/** Vault root passed to the Agent run as its cwd. */
	vaultPath: string | null;
	/** Viewer prop: open Translate settings from the error card. */
	onOpenSettings: PdfViewerProps["onOpenSettings"];
	/** Persisted translate records; owned by {@link usePdfMarksIo}. */
	translatesRef: RefObject<PdfTranslateRecord[]>;
	setTranslates: Dispatch<SetStateAction<PdfTranslateRecord[]>>;
	upsertTranslate: (rec: PdfTranslateRecord) => void;
	/** Cards cluster; owned by {@link usePdfCards}. */
	openCard: (card: ActiveSelectionCard) => void;
	hideActiveCard: () => void;
	activeCardRef: RefObject<ActiveSelectionCard | null>;
	/**
	 * Single in-flight PDF agent run, shared with the ask cluster. Parent-owned so
	 * either cluster can cancel the other's session token.
	 */
	activeSessionRef: RefObject<string | null>;
};

export type PdfSelectionTranslate = {
	translateStreaming: boolean;
	translateError: string | null;
	/** Selection-menu action: create the record and start the run. */
	translateSelection: (anchor: PdfAskAnchor) => void;
	/** Cancel the in-flight run; also wired into {@link usePdfCards}. */
	stopTranslateSession: () => void;
	/** Card header delete: drop the record from state + disk and close the card. */
	deleteTranslateCard: () => void;
	/** Error card action: open Translate settings. */
	openTranslateSettings: () => void;
	/** Per-kind chrome reset for card open / close (wired into `usePdfCards`). */
	clearTranslateError: () => void;
};

export function usePdfSelectionTranslate({
	paperAbsPath,
	paperRelPath,
	vaultPath,
	onOpenSettings,
	translatesRef,
	setTranslates,
	upsertTranslate,
	openCard,
	hideActiveCard,
	activeCardRef,
	activeSessionRef,
}: UsePdfSelectionTranslateOptions): PdfSelectionTranslate {
	const { t } = useTranslation("viewer");
	const [translateStreaming, setTranslateStreaming] = useState(false);
	const [translateError, setTranslateError] = useState<string | null>(null);
	/** ACP session of the running translate turn (null for provider translate). */
	const translateSessionRef = useRef<string | null>(null);
	/** Per-run IPC unlisteners of the in-flight translate turn (null when idle). */
	const translateUnsubsRef = useRef<UnlistenFn[] | null>(null);
	/** True once the viewer unmounts; guards runs accepted after teardown. */
	const translateDisposedRef = useRef(false);
	/** Invalidates callbacks after deletion or when a new selection starts. */
	const translateGenerationRef = useRef(0);
	/** A completed result may still be writing when its card is deleted. */
	const pendingSavesRef = useRef(new Map<string, Promise<void>>());

	// Closing the viewer must not strand the run's IPC listeners (or the run
	// itself): terminal events never arrive for a hung run, so teardown cannot
	// rely on the completed/failed handlers alone.
	useEffect(() => {
		translateDisposedRef.current = false;
		return () => {
			translateGenerationRef.current += 1;
			disposeAgentRun({
				disposedRef: translateDisposedRef,
				unsubsRef: translateUnsubsRef,
				sessionRef: translateSessionRef,
				activeSessionRef,
			});
		};
	}, [activeSessionRef]);

	const stopTranslateSession = useCallback(() => {
		const sid = translateSessionRef.current;
		if (sid) {
			void cancelAgentRun(sid).catch(() => undefined);
			if (activeSessionRef.current === sid) activeSessionRef.current = null;
			translateSessionRef.current = null;
		}
		setTranslateStreaming(false);
	}, [activeSessionRef]);

	const clearTranslateError = useCallback(() => {
		setTranslateError(null);
	}, []);

	const openTranslateSettings = useCallback(() => {
		onOpenSettings?.();
	}, [onOpenSettings]);

	const persistTranslate = useCallback(
		async (rec: PdfTranslateRecord) => {
			if (!paperAbsPath) return;
			try {
				await writePdfTranslate(paperAbsPath, rec);
			} catch {
				// keep UI responsive
			}
		},
		[paperAbsPath],
	);

	const translateSelection = useCallback(
		(anchor: PdfAskAnchor) => {
			const quote = anchor.quote?.trim();
			if (!quote) return;
			const generation = ++translateGenerationRef.current;
			stopTranslateSession();
			const paperPath = paperRelPath || paperAbsPath || "paper";
			const paperKey = paperRelPath || paperAbsPath || null;
			const rec = createTranslateRecord({
				paperPath,
				page: anchor.page,
				rects: anchor.rects,
				quote,
			});
			upsertTranslate(rec);
			openCard({ kind: "translate", id: rec.id });
			setTranslateStreaming(true);
			setTranslateError(null);
			let currentRecord = rec;
			const isCurrentRun = () =>
				translateGenerationRef.current === generation &&
				!translateDisposedRef.current;
			const commitResult = (result: string) => {
				if (!isCurrentRun()) return false;
				currentRecord = {
					...currentRecord,
					result: result.trim(),
					updatedAt: new Date().toISOString(),
					error: undefined,
				};
				upsertTranslate(currentRecord);
				setTranslateStreaming(false);
				setTranslateError(null);
				const save = persistTranslate(currentRecord);
				pendingSavesRef.current.set(rec.id, save);
				void save.then(
					() => {
						if (pendingSavesRef.current.get(rec.id) === save) {
							pendingSavesRef.current.delete(rec.id);
						}
					},
					() => {
						if (pendingSavesRef.current.get(rec.id) === save) {
							pendingSavesRef.current.delete(rec.id);
						}
					},
				);
				return true;
			};

			void runSelectionTranslate({
				text: quote,
				context: { page: anchor.page, surface: "pdf-selection" },
				paperKey,
				vaultPath,
				noAgentText: () => t("selection.translateNoAgent"),
				agentFailedText: () => t("pdfAsk.agentFailed"),
				disposedRef: translateDisposedRef,
				unsubsRef: translateUnsubsRef,
				sessionRef: translateSessionRef,
				activeSessionRef,
				appendChunk: (chunk) => {
					if (!isCurrentRun()) return;
					currentRecord = {
						...currentRecord,
						result: (currentRecord.result ?? "") + chunk,
						updatedAt: new Date().toISOString(),
						error: undefined,
					};
					upsertTranslate(currentRecord);
				},
				commitAgentResult: (ev) =>
					commitResult(ev.content || currentRecord.result || ""),
				commitProviderResult: commitResult,
				markFailed: (message) => {
					if (!isCurrentRun()) return;
					currentRecord = {
						...currentRecord,
						error: message,
						updatedAt: new Date().toISOString(),
					};
					upsertTranslate(currentRecord);
					setTranslateStreaming(false);
					setTranslateError(message);
				},
				stopStreaming: () => {
					if (isCurrentRun()) setTranslateStreaming(false);
				},
			});
		},
		[
			t,
			vaultPath,
			paperAbsPath,
			paperRelPath,
			stopTranslateSession,
			upsertTranslate,
			persistTranslate,
			openCard,
			activeSessionRef,
		],
	);

	const deleteTranslateCard = useCallback(() => {
		const id =
			activeCardRef.current?.kind === "translate"
				? activeCardRef.current.id
				: null;
		translateGenerationRef.current += 1;
		stopTranslateSession();
		if (id) {
			const pendingSave = pendingSavesRef.current.get(id);
			const remaining = translatesRef.current.filter((r) => r.id !== id);
			translatesRef.current = remaining;
			setTranslates(remaining);
			if (paperAbsPath) {
				// A completed result may still be writing; delete after that write.
				void (pendingSave ?? Promise.resolve()).then(() =>
					deletePdfTranslate(paperAbsPath, id),
				);
			}
		}
		hideActiveCard();
	}, [
		paperAbsPath,
		stopTranslateSession,
		hideActiveCard,
		activeCardRef,
		setTranslates,
		translatesRef,
	]);

	return {
		translateStreaming,
		translateError,
		translateSelection,
		stopTranslateSession,
		deleteTranslateCard,
		openTranslateSettings,
		clearTranslateError,
	};
}
