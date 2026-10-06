/** Unified PDF selection overlay (ask / annotate / translate / visual). */

export type SelectionOverlayKind =
	| "ask"
	| "annotate"
	| "translate"
	| "visual"
	/** @deprecated Prefer `"visual"`; still accepted when hydrating older UI state. */
	| "agent-trace";

/**
 * Which selection dialog is open. Anchor geometry lives on the kind-specific
 * record (ask thread / highlight / translate / visual mark); screen coords are
 * derived. Visual marks show a preview card; opening the Agent session is a
 * separate action on that card when a thread is attached.
 */
export type ActiveSelectionCard = {
	kind: SelectionOverlayKind;
	id: string;
};

export type SelectionPin = {
	id: string;
	kind: SelectionOverlayKind;
	/** 0–1 page-normalized pin position */
	x: number;
	y: number;
	preview: string;
	/** Ask threads that were dismissed still show as “ended” pins */
	ended?: boolean;
	/** Mark id when kind is visual (same as pin id). */
	traceId?: string;
	/**
	 * When true the pin sits in the middle of a line and should render
	 * translucent at rest. Side-of-line pins stay solid.
	 */
	overText?: boolean;
	/** Which side of the selection the pin prefers (affects transform). */
	side?: "left" | "right";
};
