/**
 * Clipboard helpers — single place for writeText + optional success/error toasts.
 */

import {
	type NotifyOptions,
	notifyError,
	notifySuccess,
} from "@/lib/core/notify";

export type CopyTextOptions = {
	/** Success toast; omit for silent success. */
	successMessage?: string;
	/** Error toast; omit for silent failure (still returns false). */
	errorMessage?: string;
	/** Extra options for the success toast (duration, id, …). */
	successNotify?: NotifyOptions;
};

export type ReadTextOptions = {
	/** Error toast; omit for silent failure (still returns null). */
	errorMessage?: string;
};

/**
 * Write plain text to the system clipboard.
 * @returns true when the write succeeded.
 */
export async function copyTextToClipboard(
	text: string,
	opts: CopyTextOptions = {},
): Promise<boolean> {
	try {
		if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
			throw new Error("clipboard unavailable");
		}
		await navigator.clipboard.writeText(text);
		if (opts.successMessage) {
			notifySuccess(opts.successMessage, opts.successNotify);
		}
		return true;
	} catch {
		if (opts.errorMessage) {
			notifyError(opts.errorMessage);
		}
		return false;
	}
}

/**
 * Read plain text from the system clipboard.
 * @returns clipboard text, including an empty string, or null when unavailable.
 */
export async function readTextFromClipboard(
	opts: ReadTextOptions = {},
): Promise<string | null> {
	try {
		if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
			throw new Error("clipboard unavailable");
		}
		return await navigator.clipboard.readText();
	} catch {
		if (opts.errorMessage) {
			notifyError(opts.errorMessage);
		}
		return null;
	}
}
