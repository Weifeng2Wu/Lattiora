/**
 * Vault-relative or absolute paths from a file-tree drag (`text/plain`, one path per line).
 * Returns [] when the payload is an external OS file drop.
 */
export function readDraggedVaultPaths(dt: DataTransfer | null): string[] {
	if (!dt) return [];
	const text = dt.getData("text/plain")?.trim();
	if (!text) return [];
	// External OS file drops use the Files type — leave those to import handlers.
	if (dt.types.includes("Files") && !dt.types.includes("text/plain")) {
		return [];
	}
	return text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
}

/**
 * True when the drag payload can open a split (file-tree path drag).
 * Uses `types` only — `getData` is often empty during dragover for security.
 */
export function isSplitDragPayload(dt: DataTransfer | null): boolean {
	if (!dt) return false;
	// File-tree drags set text/plain without Files (internal).
	if (dt.types.includes("text/plain") && !dt.types.includes("Files")) {
		return true;
	}
	return false;
}
