import type {
	PdfAskAnchor,
	PdfAskMessage,
	PdfAskNormalizedRect,
	PdfAskThread,
	PdfAskTrigger,
	PdfAskVisualKind,
} from "@/lib/pdf/ask/types";
import { isRecord, isRect } from "@/lib/pdf/marks/schema";
import { pinFromRects } from "@/lib/pdf/selection/pin";

function isTrigger(v: unknown): v is PdfAskTrigger {
	return (
		v === "selection" || v === "dblclick" || v === "dwell" || v === "region"
	);
}

function isVisualKind(v: unknown): v is PdfAskVisualKind {
	return v === "formula" || v === "figure";
}

function parseMessage(v: unknown): PdfAskMessage | null {
	if (!isRecord(v)) return null;
	if (typeof v.id !== "string" || typeof v.content !== "string") return null;
	if (v.role !== "user" && v.role !== "assistant" && v.role !== "system") {
		return null;
	}
	if (typeof v.createdAt !== "string") return null;
	const msg: PdfAskMessage = {
		id: v.id,
		role: v.role,
		content: v.content,
		createdAt: v.createdAt,
	};
	if (typeof v.agentSessionId === "string") {
		msg.agentSessionId = v.agentSessionId;
	}
	if (Array.isArray(v.sources)) {
		msg.sources = v.sources.filter(isRecord).map((s) => ({
			title: typeof s.title === "string" ? s.title : undefined,
			uri: typeof s.uri === "string" ? s.uri : undefined,
		}));
	}
	return msg;
}

function parseAnchor(v: unknown): PdfAskAnchor | null {
	if (!isRecord(v)) return null;
	if (typeof v.page !== "number" || !Number.isFinite(v.page)) return null;
	if (!Array.isArray(v.rects) || !v.rects.every(isRect)) return null;
	const triggerRaw = v.trigger;
	if (!isTrigger(triggerRaw)) return null;
	const trigger: PdfAskTrigger = triggerRaw;
	const anchor: PdfAskAnchor = {
		page: Math.max(1, Math.floor(v.page)),
		rects: v.rects as PdfAskNormalizedRect[],
		trigger,
	};
	if (typeof v.quote === "string") anchor.quote = v.quote;
	if (isVisualKind(v.visualKind)) anchor.visualKind = v.visualKind;
	return anchor;
}

/** Validate and normalize a thread JSON payload. Returns null if invalid. */
export function parsePdfAskThread(raw: unknown): PdfAskThread | null {
	if (!isRecord(raw)) return null;
	if (raw.version !== 1) return null;
	if (raw.kind !== "ask") return null;
	if (typeof raw.id !== "string" || !raw.id) return null;
	if (typeof raw.paperPath !== "string") return null;
	if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") {
		return null;
	}
	if (raw.status !== "open" && raw.status !== "ended") return null;
	const anchor = parseAnchor(raw.anchor);
	if (!anchor) return null;
	if (!Array.isArray(raw.messages)) return null;
	const messages: PdfAskMessage[] = [];
	for (const m of raw.messages) {
		const parsed = parseMessage(m);
		if (!parsed) return null;
		messages.push(parsed);
	}
	return {
		version: 1,
		kind: "ask",
		id: raw.id,
		paperPath: raw.paperPath,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		status: raw.status,
		anchor,
		messages,
	};
}

function shorten(text: string, max: number): string {
	const t = text.trim().replace(/\s+/g, " ");
	if (!t) return "";
	return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t;
}

/** True once the user has sent at least one turn. */
export function threadHasUserQuestion(thread: PdfAskThread): boolean {
	return thread.messages.some((m) => m.role === "user");
}

/** Longer preview for tooltips / gutter aria. */
export function threadPreview(thread: PdfAskThread): string {
	const firstUser = thread.messages.find((m) => m.role === "user");
	if (firstUser?.content.trim()) {
		return shorten(firstUser.content, 80) || thread.id;
	}
	const q = thread.anchor.quote?.trim() ?? "";
	if (q) return shorten(q, 80);
	return thread.id;
}

/** Shortest conversation summary for dialog header. */
export function threadTitle(
	thread: PdfAskThread,
	emptyFallback: string,
): string {
	const firstUser = thread.messages.find((m) => m.role === "user");
	if (firstUser?.content.trim()) {
		return shorten(firstUser.content, 28) || emptyFallback;
	}
	const firstAssistant = thread.messages.find((m) => m.role === "assistant");
	if (firstAssistant?.content.trim()) {
		return shorten(firstAssistant.content, 28) || emptyFallback;
	}
	return emptyFallback;
}

/** Pin on the side of the selection (prefer right of union rects). */
export function threadPin(thread: PdfAskThread) {
	return pinFromRects(thread.anchor.rects);
}
