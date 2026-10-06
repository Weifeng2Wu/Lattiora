import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

/** Reject invalid documents instead of silently autosaving an empty canvas. */
export function parseExcalidrawDocument(
	seed: string,
): ExcalidrawInitialDataState {
	if (!seed.trim()) return { elements: [], appState: {}, files: {} };
	const data = JSON.parse(seed);
	if (
		data?.type !== "excalidraw" ||
		data.version !== 2 ||
		!Array.isArray(data.elements) ||
		(data.appState != null &&
			(typeof data.appState !== "object" || Array.isArray(data.appState))) ||
		(data.files != null &&
			(typeof data.files !== "object" || Array.isArray(data.files))) ||
		data.elements.some(
			(element: unknown) =>
				!element ||
				typeof element !== "object" ||
				!("id" in element) ||
				!("type" in element),
		)
	)
		throw new Error("Invalid Excalidraw document");
	return {
		elements: data.elements,
		appState: data.appState ?? {},
		files: data.files ?? {},
	};
}
