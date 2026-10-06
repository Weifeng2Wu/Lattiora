/**
 * Region-crop visual marks for the EmbedPDF viewer.
 *
 * Note-only marks live in the right-rail comment card column; marks that carry
 * an Agent conversation but no note use a floating conversation card beside
 * their gutter pin. The "add to sidebar chat" action lives on the comment card.
 * This hook persists new crops, updates comments from the rail, deletes marks,
 * and adds existing marks to the Agent composer.
 *
 * Boundaries:
 * - the persisted mark array lives in {@link usePdfMarksIo}: setters and the
 *   mirror ref are injected, never re-declared here;
 * - comment-rail edits are owned by {@link usePdfNoteEditor}; this hook only
 *   supplies the visual-specific writers.
 */

import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import type {
	RailEditState,
	VisualDraftEditorState,
} from "@/components/viewer/pdf/types";
import { addVisualDraft } from "@/lib/agent/visual-context-store";
import { errorText } from "@/lib/core/error";
import { notifyError } from "@/lib/core/notify";
import {
	createNoteTrace,
	deletePdfVisualTrace,
	type PdfVisualSessionTrace,
	writePdfVisualTrace,
} from "@/lib/pdf/agent-trace";
import { loadPdfVisualTraceImage } from "@/lib/pdf/agent-trace/image";
import { DEFAULT_HIGHLIGHT_COLOR } from "@/lib/pdf/highlight/palette";
import { openRightTab } from "@/lib/shell/ui-window-actions";

export type UsePdfVisualMarksOptions = {
	/** Sidecar root for `marks/<id>.json` (null for loose PDFs — nothing persists). */
	paperAbsPath: string | null;
	/** Vault-relative provenance stamped into new marks. */
	paperRelPath: string | null;
	/** Persisted visual marks; owned by {@link usePdfMarksIo}. */
	visualTracesRef: RefObject<PdfVisualSessionTrace[]>;
	setVisualTraces: Dispatch<SetStateAction<PdfVisualSessionTrace[]>>;
	upsertVisualTrace: (trace: PdfVisualSessionTrace) => void;
	/**
	 * Ref to the rail editor opener. A ref breaks the declaration-order cycle
	 * with {@link usePdfNoteEditor} (#396).
	 */
	beginRailEditRef: RefObject<(state: RailEditState) => void>;
};

export type PdfVisualMarks = {
	/**
	 * Persist a freshly-cropped region as a note-only visual mark and optionally
	 * open it in the right-rail comment editor (#396).
	 */
	handleVisualDraft: (
		draft: VisualDraftEditorState,
		beginEdit?: boolean,
	) => void;
	/** Persist a comment by mark id (comment-rail in-place edit). */
	updateVisualComment: (id: string, comment: string) => void;
	/** Add an existing visual mark's crop to the Agent sidebar composer (#396). */
	handleVisualAddToChatById: (id: string) => void;
	/** Drop a mark from state + disk (also used by the imperative handle). */
	deleteVisualTraceById: (id: string) => void;
};

export function usePdfVisualMarks({
	paperAbsPath,
	paperRelPath,
	visualTracesRef,
	setVisualTraces,
	upsertVisualTrace,
	beginRailEditRef,
}: UsePdfVisualMarksOptions): PdfVisualMarks {
	const { t } = useTranslation("viewer");

	/**
	 * Persist a freshly-cropped region as a note-only visual mark. When
	 * `beginEdit` is true (default) the new mark is opened in the right-rail
	 * comment editor so the user can type the note immediately (#396).
	 */
	const handleVisualDraft = useCallback(
		(draft: VisualDraftEditorState, beginEdit = true) => {
			const paperPath = paperRelPath || paperAbsPath || "paper";
			let mark: PdfVisualSessionTrace;
			try {
				mark = createNoteTrace({
					paperPath,
					page: draft.page,
					rects: [draft.region],
					comment: "",
					image: {
						data: draft.image.data,
						mimeType: draft.image.mimeType || "image/png",
					},
				});
			} catch {
				return;
			}
			upsertVisualTrace(mark);
			if (paperAbsPath) {
				void writePdfVisualTrace(paperAbsPath, mark).catch((error) => {
					console.warn("[visual-mark] save note failed", error);
					notifyError(errorText(error));
				});
			}
			if (beginEdit) {
				beginRailEditRef.current?.({
					id: mark.id,
					pageIndex: draft.page - 1,
					kind: "visual",
					comment: "",
					quote: "",
					color: DEFAULT_HIGHLIGHT_COLOR,
					anchorY: draft.region.y,
					rects: [draft.region],
				});
			}
		},
		[paperRelPath, paperAbsPath, upsertVisualTrace, beginRailEditRef],
	);

	/** Persist a comment by mark id (rail in-place edit). */
	const updateVisualComment = useCallback(
		(id: string, comment: string) => {
			const latest = visualTracesRef.current.find((tr) => tr.id === id);
			if (!latest) return;
			const next: PdfVisualSessionTrace = {
				...latest,
				comment: comment.trim(),
				updatedAt: new Date().toISOString(),
			};
			// Keep content invariant: need comment, agent, or crop image.
			if (
				!next.comment &&
				!next.agent &&
				!next.image?.path &&
				!next.image?.data
			) {
				return;
			}
			upsertVisualTrace(next);
			if (paperAbsPath) {
				void writePdfVisualTrace(paperAbsPath, next).catch((error) => {
					console.warn("[visual-mark] update comment failed", error);
					notifyError(errorText(error));
				});
			}
		},
		[paperAbsPath, upsertVisualTrace, visualTracesRef],
	);

	/** Add an existing visual mark's crop to the Agent sidebar composer (#396). */
	const handleVisualAddToChatById = useCallback(
		(id: string) => {
			const latest = visualTracesRef.current.find((tr) => tr.id === id);
			if (!latest) return;
			void (async () => {
				const image = await loadPdfVisualTraceImage(
					paperAbsPath ?? "",
					latest.image,
				);
				if (!image?.data) {
					notifyError(t("pdfExplain.cropFailed"));
					return;
				}
				addVisualDraft({
					id: latest.id,
					paperPath:
						latest.paperPath || paperRelPath || paperAbsPath || "paper",
					paperAbsPath: paperAbsPath ?? undefined,
					page: latest.page,
					rects: latest.rects,
					comment: latest.comment,
					image: {
						data: image.data,
						mimeType: image.mimeType || "image/png",
					},
				});
				openRightTab("agent");
			})();
		},
		[paperAbsPath, paperRelPath, t, visualTracesRef],
	);

	const deleteVisualTraceById = useCallback(
		(id: string) => {
			setVisualTraces((prev) => prev.filter((tr) => tr.id !== id));
			if (paperAbsPath) void deletePdfVisualTrace(paperAbsPath, id);
		},
		[paperAbsPath, setVisualTraces],
	);

	return {
		handleVisualDraft,
		updateVisualComment,
		handleVisualAddToChatById,
		deleteVisualTraceById,
	};
}
