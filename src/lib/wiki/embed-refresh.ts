type WikiEmbedRefreshListener = () => void;

const listenersByPath = new Map<string, Set<WikiEmbedRefreshListener>>();

function refreshPathKey(path: string): string {
	return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Subscribe one rendered embed to changes of its resolved target file.
 * Notifications are path-scoped so editing an unrelated note cannot rerender it.
 */
export function subscribeWikiEmbedTarget(
	absolutePath: string,
	listener: WikiEmbedRefreshListener,
): () => void {
	const key = refreshPathKey(absolutePath);
	if (!key) return () => {};
	const listeners = listenersByPath.get(key) ?? new Set();
	listeners.add(listener);
	listenersByPath.set(key, listeners);
	return () => {
		listeners.delete(listener);
		if (!listeners.size) listenersByPath.delete(key);
	};
}

/** Notify only embeds whose resolved target was touched by the watcher batch. */
export function notifyWikiEmbedTargets(paths: string[]): void {
	for (const path of new Set(paths.map(refreshPathKey))) {
		const listeners = listenersByPath.get(path);
		if (!listeners) continue;
		for (const listener of listeners) listener();
	}
}
