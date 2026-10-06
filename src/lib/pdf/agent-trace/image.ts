import type { PromptImage } from "@/lib/agent/api";
import type { PdfVisualSessionTrace } from "@/lib/pdf/agent-trace/types";
import { joinVaultPath, readVaultBytes } from "@/lib/vault";

export const VISUAL_TRACE_ASSET_FOLDER = "assets";

export type PdfVisualTraceImageAssetWrite = {
	path: string;
	bytes: Uint8Array;
};

/** Accept only mark-local asset paths; never resolve absolute or parent paths. */
export function normalizeVisualTraceImagePath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
	const parts = normalized.split("/");
	if (
		parts.length !== 2 ||
		parts[0] !== VISUAL_TRACE_ASSET_FOLDER ||
		!parts[1] ||
		parts[1] === "." ||
		parts[1] === ".."
	) {
		return null;
	}
	return normalized;
}

function imageExtension(mimeType: string): string {
	switch (mimeType.toLowerCase()) {
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		default:
			return "png";
	}
}

export function visualTraceImageAssetRelPath(
	traceId: string,
	mimeType: string,
): string {
	return `${VISUAL_TRACE_ASSET_FOLDER}/${encodeURIComponent(traceId)}.${imageExtension(mimeType)}`;
}

export function visualTraceImageAssetPath(
	paperAbsPath: string,
	imagePath: string,
): string | null {
	const rel = normalizeVisualTraceImagePath(imagePath);
	return rel ? joinVaultPath(joinVaultPath(paperAbsPath, "marks"), rel) : null;
}

function base64ToBytes(data: string): Uint8Array {
	const binary = atob(data);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		const chunk = bytes.subarray(offset, offset + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

/**
 * Convert a runtime inline crop into the only on-disk representation.
 * The returned trace is safe to serialize into the mark JSON.
 */
export function preparePdfVisualTraceImageWrite(trace: PdfVisualSessionTrace): {
	trace: PdfVisualSessionTrace;
	asset?: PdfVisualTraceImageAssetWrite;
} {
	const image = trace.image;
	if (!image) return { trace };
	if (image.data) {
		const mimeType = image.mimeType || "image/png";
		const path = visualTraceImageAssetRelPath(trace.id, mimeType);
		return {
			trace: {
				...trace,
				image: { path, mimeType },
			},
			asset: {
				path,
				bytes: base64ToBytes(image.data),
			},
		};
	}
	const path = normalizeVisualTraceImagePath(image.path);
	if (!path) {
		throw new Error("invalid visual trace image path");
	}
	return {
		trace: {
			...trace,
			image: {
				path,
				mimeType: image.mimeType || "image/png",
			},
		},
	};
}

/** Resolve a runtime crop or mark-owned asset only when a consumer needs it. */
export async function loadPdfVisualTraceImage(
	paperAbsPath: string,
	image: PdfVisualSessionTrace["image"],
): Promise<PromptImage | null> {
	if (image?.data) {
		return { data: image.data, mimeType: image.mimeType || "image/png" };
	}
	if (!image?.path || !paperAbsPath) return null;
	const path = visualTraceImageAssetPath(paperAbsPath, image.path);
	if (!path) return null;
	try {
		const bytes = await readVaultBytes(path);
		return {
			data: bytesToBase64(bytes),
			mimeType: image.mimeType || "image/png",
		};
	} catch {
		return null;
	}
}
