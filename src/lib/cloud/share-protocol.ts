/** Shared browser / Worker contract; snapshots never expose workspace files. */
export const MAX_SHARE_BYTES = 16 * 1024 * 1024;
export const NOTE_SHARE_MIME = "application/vnd.agentero.note+json";
export type NoteShareSnapshot = {
	version: 1;
	notes: { title: string; markdown: string }[];
};
export function isNoteShareSnapshot(
	value: unknown,
): value is NoteShareSnapshot {
	if (!value || typeof value !== "object") return false;
	const snapshot = value as NoteShareSnapshot;
	return (
		snapshot.version === 1 &&
		Array.isArray(snapshot.notes) &&
		snapshot.notes.length > 0 &&
		snapshot.notes.every(
			(note) =>
				note &&
				typeof note.title === "string" &&
				note.title.length > 0 &&
				note.title.length <= 240 &&
				typeof note.markdown === "string",
		)
	);
}
export const SHARE_MIME = {
	pdf: "application/pdf",
	png: "image/png",
	md: "text/markdown;charset=utf-8",
} as const;
export type ShareFormat = keyof typeof SHARE_MIME;
export type ShareSettings = { key: string | null; expiresAt: number | null };
export type ShareInfo = {
	id: string;
	sourcePath: string;
	title: string;
	format: ShareFormat;
	hasKey: boolean;
	createdAt: number;
	expiresAt: number | null;
	revokedAt: number | null;
};
