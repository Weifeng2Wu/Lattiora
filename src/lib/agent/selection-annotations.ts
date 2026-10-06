import { createStore } from "zustand/vanilla";
import type { SelectionContext } from "./selection-store";

export type AnnotationBinding = {
	selections: SelectionContext[];
	update: (id: string, comment: string | null) => void;
};
export const annotationStore = createStore<{
	binding: AnnotationBinding | null;
	releasedId: string | null;
}>(() => ({ binding: null, releasedId: null }));
/** DOM anchors are transient and never serialized into a prompt or persisted draft. */
export const annotationRanges = new Map<string, Range>();
export function editAnnotation(id: string, comment: string | null) {
	const binding = annotationStore.getState().binding;
	if (!binding?.selections.some((selection) => selection.id === id))
		return false;
	if (comment === null) releaseAnnotationAnchor(id);
	binding.update(id, comment);
	return true;
}

export const annotationPdfAnchors = new Map<
	string,
	{
		documentId: string;
		page: number;
		rect: { x: number; y: number; w: number; h: number };
	}
>();

/** Delete only the selection owned by this annotation, preserving unrelated live selections. */
export function releaseAnnotationAnchor(id: string): void {
	const anchor = annotationRanges.get(id);
	if (anchor) {
		const matches = (range: AbstractRange) =>
			range.startContainer === anchor.startContainer &&
			range.startOffset === anchor.startOffset &&
			range.endContainer === anchor.endContainer &&
			range.endOffset === anchor.endOffset;
		const selection =
			typeof window === "undefined" ? null : window.getSelection();
		if (
			selection &&
			Array.from({ length: selection.rangeCount }, (_, i) =>
				selection.getRangeAt(i),
			).some(matches)
		)
			selection.removeAllRanges();
		if (typeof CSS !== "undefined" && CSS.highlights) {
			for (const name of [
				"agentero-annotation-selection",
				"agentero-context-selection",
				"agentero-annotation-navigation",
			]) {
				const highlight = CSS.highlights.get(name);
				if (!highlight) continue;
				for (const range of highlight)
					if (matches(range)) highlight.delete(range);
				if (!highlight.size) CSS.highlights.delete(name);
			}
		}
	}
	annotationRanges.delete(id);
	annotationPdfAnchors.delete(id);
	annotationStore.setState({ releasedId: id });
}
