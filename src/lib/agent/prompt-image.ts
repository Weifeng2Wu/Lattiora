/**
 * Convert composer file attachments (data URLs from PromptInput) into ACP
 * PromptImage payloads (raw base64 + mime).
 *
 * Desktop attach button uses Tauri native dialog filters (hard type restrict).
 * HTML `accept` remains for paste/drop validation and non-Tauri fallback.
 */

import type { FileUIPart } from "ai";
import type { PromptImage } from "@/lib/agent/api";
import { fileMatchesAccept, hasImageExtension } from "@/lib/core/file-accept";
import { pathsFromDataTransfer } from "@/lib/shell/external-file-drop";

/** Extensions for Tauri `dialog.open` filters (no leading dots). */
export const COMPOSER_IMAGE_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"webp",
	"gif",
	"bmp",
	"heic",
	"heif",
	"avif",
	"svg",
	"ico",
] as const;

/**
 * HTML file-input `accept` (MIME + extensions). Weaker than native dialog
 * filters; used for drop/paste validation and browser fallback.
 */
export const COMPOSER_IMAGE_ACCEPT = [
	"image/*",
	...COMPOSER_IMAGE_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");

export const COMPOSER_IMAGE_MAX_FILES = 8;
/** 10 MiB per image — large enough for screenshots, small enough for ACP. */
export const COMPOSER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Desktop: open a native image-only file dialog (extension filters so PDF etc.
 * are not selectable), read bytes, return browser `File` objects for PromptInput.
 * Returns `null` when not running under Tauri (caller may fall back to `<input>`).
 * Returns `[]` when the user cancels.
 */
export async function pickComposerImageFiles(_opts?: {
	/** How many more images may be attached (capacity remaining). */
	remainingSlots?: number;
	/** Dialog window title. */
	title?: string;
	/** Filter group label shown in the native dialog. */
	filterName?: string;
}): Promise<File[] | null> {
	return null;
}

/** Absolute image paths in a drop payload (Finder / Preview often omit FileList). */
export function imagePathsFromDataTransfer(
	dt: DataTransfer | null | undefined,
): string[] {
	if (!dt) return [];
	return pathsFromDataTransfer(dt).filter((path) => hasImageExtension(path));
}

/**
 * Read local image paths into browser `File` objects (Tauri only).
 * Used when a macOS drop exposes `text/plain` / `text/uri-list` paths but
 * no `FileList` (common WKWebView case).
 */
export async function readComposerImageFiles(
	_paths: string[],
	_remainingSlots: number = COMPOSER_IMAGE_MAX_FILES,
): Promise<File[]> {
	return [];
}

const DATA_URL_RE = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i;

/** True when a File looks like an image (MIME and/or extension). */
export function isImageFile(file: File): boolean {
	return fileMatchesAccept(file, "image/*");
}

/** Parse a data URL into ACP PromptImage (raw base64, no data: prefix). */
export function dataUrlToPromptImage(
	url: string,
	mimeHint?: string,
): PromptImage | null {
	const trimmed = url.trim();
	const match = trimmed.match(DATA_URL_RE);
	if (!match) return null;
	const mime = (match[1] || mimeHint || "image/png").trim().toLowerCase();
	const data = match[2]?.trim();
	if (!data || !mime.startsWith("image/")) return null;
	return { data, mimeType: mime };
}

/** Keep only image FileUIParts that already carry data URLs (post-submit conversion). */
export function fileUiPartsToPromptImages(
	files: readonly FileUIPart[] | undefined | null,
): PromptImage[] {
	if (!files?.length) return [];
	const out: PromptImage[] = [];
	for (const file of files) {
		const mediaType = (file.mediaType || "").trim().toLowerCase();
		if (mediaType && !mediaType.startsWith("image/")) continue;
		const url = file.url?.trim();
		if (!url) continue;
		const image = dataUrlToPromptImage(url, mediaType || undefined);
		if (image) out.push(image);
	}
	return out;
}

/** Bound the API/session payload while accepting the original 8 × 10 MiB input limit. */
export async function prepareBrowserPromptImages(
	images: PromptImage[],
): Promise<PromptImage[]> {
	if (images.length > COMPOSER_IMAGE_MAX_FILES)
		throw new Error("tooManyImages");
	return Promise.all(
		images.map(async (image) => {
			if (image.data.length > Math.ceil(COMPOSER_IMAGE_MAX_BYTES / 3) * 4)
				throw new Error("tooLarge");
			if (
				["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) &&
				image.data.length < 900000
			)
				return image;
			const raw = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
			const bitmap = await createImageBitmap(
				new Blob([raw], { type: image.mimeType }),
			);
			try {
				const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(1, Math.round(bitmap.width * scale));
				canvas.height = Math.max(1, Math.round(bitmap.height * scale));
				const context = canvas.getContext("2d");
				if (!context) throw new Error("invalidImage");
				context.fillStyle = "white";
				context.fillRect(0, 0, canvas.width, canvas.height);
				context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
				for (const quality of [0.92, 0.8, 0.65, 0.5]) {
					const data = canvas.toDataURL("image/jpeg", quality).split(",")[1];
					if (data.length < 1000000) return { data, mimeType: "image/jpeg" };
				}
				throw new Error("tooLarge");
			} finally {
				bitmap.close();
			}
		}),
	);
}
