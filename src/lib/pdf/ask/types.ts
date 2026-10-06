/** PDF selection-ask thread model. See docs/development/pdf-ask.md */

export type PdfAskTrigger = "selection" | "dblclick" | "dwell" | "region";

export type PdfAskVisualKind = "formula" | "figure";

export type PdfAskStatus = "open" | "ended";

export type PdfAskMessageRole = "user" | "assistant" | "system";

export type PdfAskNormalizedRect = {
	/** 0–1 relative to page box */
	x: number;
	y: number;
	w: number;
	h: number;
};

export type PdfAskAnchor = {
	page: number;
	rects: PdfAskNormalizedRect[];
	quote?: string;
	trigger: PdfAskTrigger;
	/** Visual crop semantics for multimodal formula/figure explanations. */
	visualKind?: PdfAskVisualKind;
};

export type PdfAskMessage = {
	id: string;
	role: PdfAskMessageRole;
	content: string;
	createdAt: string;
	agentSessionId?: string;
	sources?: { title?: string; uri?: string }[];
};

export type PdfAskThread = {
	version: 1;
	/** marks/ discriminator */
	kind: "ask";
	id: string;
	/** Vault-relative paper folder when known; else absolute hint */
	paperPath: string;
	createdAt: string;
	updatedAt: string;
	status: PdfAskStatus;
	anchor: PdfAskAnchor;
	messages: PdfAskMessage[];
};
