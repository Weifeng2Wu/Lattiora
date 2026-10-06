const WIKI_TARGET_EXTENSION =
	/\.(md|mdx|markdown|pdf|png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

/** Paths currently indexed as Wiki link or embed targets. */
export function isWikiTargetPath(path: string): boolean {
	return WIKI_TARGET_EXTENSION.test(path);
}

/**
 * Watcher rename events cannot reliably distinguish files from directories.
 * Handle known Wiki targets and extensionless, directory-like paths; an
 * explicit non-target extension only needs the normal workspace refresh.
 */
export function renameMayAffectWikiTargets(paths: readonly string[]): boolean {
	if (paths.length === 0) return true;
	return paths.some(
		(path) =>
			isWikiTargetPath(path) || !/(^|[\\/])[^\\/]*\.[^./\\]+$/.test(path),
	);
}
