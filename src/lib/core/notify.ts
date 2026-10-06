/**
 * Global user-facing notifications (top-right toasts via Sonner).
 *
 * Use for operational failures across vault / lookup / tree / library.
 * Keep form-field validation (inline under the input) local to the form.
 */

import { toast } from "sonner";
import { BACKGROUND_TASK_CANCELLED_MESSAGE } from "@/lib/core/background-tasks";

export type NotifyOptions = {
	/** Optional secondary line under the title. */
	description?: string;
	/** Stable id collapses duplicates (same id replaces the previous toast). */
	id?: string | number;
	/** Auto-dismiss ms; default 7s for errors. */
	duration?: number;
};

/** Show an error toast in the top-right stack. */
export function notifyError(
	message: string,
	opts: NotifyOptions = {},
): string | number {
	const text = message?.trim();
	if (!text) return "";
	// User-initiated cancel is not an error — do not toast.
	if (text === BACKGROUND_TASK_CANCELLED_MESSAGE) return "";
	return toast.error(text, {
		description: opts.description,
		id: opts.id,
		duration: opts.duration ?? 7000,
	});
}

/** Warning / soft failure (e.g. import partial success with warnings). */
export function notifyWarning(
	message: string,
	opts: NotifyOptions = {},
): string | number {
	const text = message?.trim();
	if (!text) return "";
	return toast.warning(text, {
		description: opts.description,
		id: opts.id,
		duration: opts.duration ?? 6000,
	});
}

/** Brief success feedback (optional; keep rare per UI simplicity rules). */
export function notifySuccess(
	message: string,
	opts: NotifyOptions = {},
): string | number {
	const text = message?.trim();
	if (!text) return "";
	return toast.success(text, {
		description: opts.description,
		id: opts.id,
		duration: opts.duration ?? 3500,
	});
}

export type UndoOptions = {
	actionLabel: string;
	onAction: () => void;
	/** Auto-dismiss ms; default 8s so the action stays reachable. */
	duration?: number;
};

/** Neutral toast with an inline action (e.g. "Deleted N · Undo"). */
export function notifyUndo(
	message: string,
	{ actionLabel, onAction, duration }: UndoOptions,
): string | number {
	const text = message?.trim();
	if (!text) return "";
	return toast(text, {
		duration: duration ?? 8000,
		action: { label: actionLabel, onClick: onAction },
	});
}

export type ActionOptions = NotifyOptions & {
	actionLabel: string;
	onAction: () => void;
};

/** Neutral notice with an explicit action, for non-destructive workflows. */
export function notifyAction(
	message: string,
	{ actionLabel, onAction, description, id, duration }: ActionOptions,
): string | number {
	const text = message?.trim();
	if (!text) return "";
	return toast(text, {
		description,
		id,
		duration: duration ?? 12_000,
		action: { label: actionLabel, onClick: onAction },
	});
}

/** Coerce unknown catch values into a display string. */
export function errorMessage(err: unknown, fallback = "Error"): string {
	if (err instanceof Error && err.message.trim()) return err.message;
	if (typeof err === "string" && err.trim()) return err;
	if (err != null && String(err).trim()) return String(err);
	return fallback;
}
