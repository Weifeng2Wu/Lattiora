"use client";

import { MarkdownPlugin } from "@platejs/markdown";
import type { PlateEditor } from "platejs/react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { prepareMarkdownForDeserialize } from "@/lib/markdown/deserialize";
import {
	frontmatterInterior,
	joinFrontmatter,
	splitFrontmatter,
	wrapFrontmatter,
} from "@/lib/markdown/frontmatter";
import {
	collectImageUrlCounts,
	createManagedAssetGc,
} from "@/lib/markdown/image";
import { settleMarkdownSaveAttempt } from "@/lib/markdown/save-state";

const CHANGE_DEBOUNCE_MS = 500;

type UseMarkdownPersistenceOptions = {
	editor: PlateEditor;
	initialMarkdown: string;
	filePath?: string | null;
	readOnly?: boolean;
	onPersist?: (
		path: string,
		markdown: string,
		lastSaved: string,
	) => Promise<boolean>;
	onDirtyChange?: (dirty: boolean) => void;
	/**
	 * Mirrored props owned by the caller: the Plate plugin store is built before
	 * this hook runs, so both it and autosave read the same cells.
	 */
	filePathRef: RefObject<string | null>;
	onAssetsChangedRef: RefObject<(() => void) | undefined>;
};

export type MarkdownPersistence = {
	/** YAML interior for the Properties panel (no `---` fences). */
	frontmatterYaml: string;
	onFrontmatterChange: (interior: string) => void;
	/** The whole document as Markdown, frontmatter re-attached. */
	serialize: () => string;
	/** Debounced autosave; also reconciles `./assets/` when the debounce fires. */
	noteDocumentChanged: () => void;
	/** Flush the pending debounce and write immediately. */
	saveNow: () => void;
	/**
	 * Replace the whole document in place after an external/Agent disk write.
	 * Does not remount the editor, does not mark it dirty and does not trigger
	 * autosave. Returns false when the content matches the current disk
	 * snapshot (own-write echo) and nothing was reloaded.
	 */
	applyExternalMarkdown: (markdown: string) => boolean;
	/** Content currently believed to be on disk. */
	savedRef: RefObject<string>;
	dirtyRef: RefObject<boolean>;
};

/**
 * Autosave, dirty tracking and managed `./assets/` GC for one open file.
 *
 * The debounce, the in-flight/queued pair and the unmount flush exist so a fast
 * file switch still lands the last edit on the file it was typed into.
 */
export function useMarkdownPersistence({
	editor,
	initialMarkdown,
	filePath,
	readOnly,
	onPersist,
	onDirtyChange,
	filePathRef,
	onAssetsChangedRef,
}: UseMarkdownPersistenceOptions): MarkdownPersistence {
	const frontmatterRef = useRef("");
	const [frontmatterYaml, setFrontmatterYaml] = useState(() => {
		const { frontmatter } = splitFrontmatter(initialMarkdown);
		// Seed ref before first serialize / persist can run.
		frontmatterRef.current = frontmatter;
		return frontmatterInterior(frontmatter);
	});
	const savedRef = useRef(initialMarkdown);
	const readyRef = useRef(false);
	/**
	 * Tracks the dirty flag so `onDirtyChange` fires only on a real transition.
	 * Without this, every keystroke would call it and re-render the whole app
	 * (the tab-bar unsaved indicator), which made editing laggy on large notes.
	 */
	const dirtyRef = useRef(false);
	const persistInFlightRef = useRef<Promise<void> | null>(null);
	const persistQueuedRef = useRef(false);
	/**
	 * True while `applyExternalMarkdown` replaces the document: the resulting
	 * editor change is disk content, not a user edit, so it must not mark the
	 * document dirty or schedule autosave.
	 */
	const externalReloadRef = useRef(false);
	/** Bumped by external reloads so an in-flight persist cannot settle stale state. */
	const reloadGenerationRef = useRef(0);
	/** Image URL ref-counts; used to GC `./assets/` when an image node is removed. */
	const imageCountsRef = useRef<Map<string, number> | null>(null);
	/**
	 * Debounced asset GC so cut → paste / undo still finds the file.
	 * Immediate delete used to leave a live `./assets/…` node with a missing file.
	 */
	const assetGcRef = useRef(
		createManagedAssetGc({
			onDeleted: () => {
				onAssetsChangedRef.current?.();
			},
		}),
	);

	const serialize = useCallback(() => {
		const body = editor.getApi(MarkdownPlugin).markdown.serialize();
		return joinFrontmatter(frontmatterRef.current, body);
	}, [editor]);

	const setDirty = useCallback(
		(dirty: boolean) => {
			if (dirtyRef.current === dirty) return;
			dirtyRef.current = dirty;
			onDirtyChange?.(dirty);
		},
		[onDirtyChange],
	);

	const persist = useCallback(() => {
		if (readOnly || !filePath || !onPersist) return;
		persistQueuedRef.current = true;
		if (persistInFlightRef.current) return;

		const task = (async () => {
			while (persistQueuedRef.current) {
				persistQueuedRef.current = false;
				const markdown = serialize();
				const lastSaved = savedRef.current;
				if (markdown === lastSaved) {
					setDirty(false);
					continue;
				}
				if (!markdown.trim() && lastSaved.trim()) return;

				const generation = reloadGenerationRef.current;
				let persisted = false;
				try {
					persisted = await onPersist(filePath, markdown, lastSaved);
				} catch {
					// The App owns user-facing persistence errors. Keep this editor
					// dirty and retain the last disk-confirmed snapshot.
				}
				// An external reload replaced the document while this write was in
				// flight; its snapshot is authoritative, do not settle over it.
				if (generation !== reloadGenerationRef.current) return;
				const settlement = settleMarkdownSaveAttempt({
					attemptedMarkdown: markdown,
					currentMarkdown: serialize(),
					lastSaved,
					persisted,
				});
				savedRef.current = settlement.savedMarkdown;
				setDirty(settlement.dirty);
				if (!persisted) {
					persistQueuedRef.current = false;
					return;
				}
				if (settlement.retryLatest) persistQueuedRef.current = true;
			}
		})();
		persistInFlightRef.current = task;
		const finish = () => {
			if (persistInFlightRef.current === task) {
				persistInFlightRef.current = null;
				if (persistQueuedRef.current) persistRef.current();
			}
		};
		void task.then(finish, finish);
	}, [filePath, onPersist, readOnly, serialize, setDirty]);

	// Latest persist closure, for the unmount flush (captures this file's path).
	const persistRef = useRef(persist);
	persistRef.current = persist;

	/**
	 * Diff `./assets/` ref-counts and hand the delta to the GC.
	 *
	 * `collectImageUrlCounts` walks every node, so this runs once per debounce
	 * window rather than per keystroke. The GC is itself debounced, so deferring
	 * the diff does not change when files actually get deleted.
	 */
	const reconcileAssets = useCallback(() => {
		const nextCounts = collectImageUrlCounts(editor.children);
		const prevCounts = imageCountsRef.current;
		imageCountsRef.current = nextCounts;
		const mdPath = filePathRef.current;
		// Skip bookkeeping for image-free notes — the common case.
		if (mdPath && prevCounts && (prevCounts.size || nextCounts.size)) {
			assetGcRef.current.observe(mdPath, prevCounts, nextCounts);
		}
	}, [editor, filePathRef]);
	const reconcileAssetsRef = useRef(reconcileAssets);
	reconcileAssetsRef.current = reconcileAssets;

	/** Debounced autosave; flushed on unmount, cancelled by external reloads. */
	const debouncedPersist = useDebouncedCallback(() => {
		reconcileAssetsRef.current();
		persistRef.current();
	}, CHANGE_DEBOUNCE_MS);

	// Mark ready after the initial normalization pass so opening a file never saves.
	// Seed image URL counts so we only GC assets removed after open.
	// On unmount, flush pending edit + deferred asset GC for this file.
	useEffect(() => {
		readyRef.current = true;
		imageCountsRef.current = collectImageUrlCounts(editor.children);
		const assetGc = assetGcRef.current;
		return () => {
			debouncedPersist.flush();
			void assetGc.flush();
		};
	}, [editor, debouncedPersist]);

	const schedulePersist = useCallback(() => {
		if (readOnly || !readyRef.current || externalReloadRef.current) return;
		if (!dirtyRef.current) {
			setDirty(true);
		}
		debouncedPersist();
	}, [readOnly, setDirty, debouncedPersist]);

	/**
	 * Reload the whole document from an external/Agent disk write without
	 * remounting the editor (keeps plugins, DOM and scroll position alive).
	 * The caller (tab layer) has already decided the disk content wins.
	 */
	const applyExternalMarkdown = useCallback(
		(markdown: string) => {
			// Own-write echo (autosave advanced the seed): nothing to reload.
			if (markdown === savedRef.current && !dirtyRef.current) return false;
			reloadGenerationRef.current += 1;
			persistQueuedRef.current = false;
			debouncedPersist.cancel();
			const { frontmatter, body } = splitFrontmatter(markdown);
			frontmatterRef.current = frontmatter;
			setFrontmatterYaml(frontmatterInterior(frontmatter));
			externalReloadRef.current = true;
			try {
				const value = editor
					.getApi(MarkdownPlugin)
					.markdown.deserialize(prepareMarkdownForDeserialize(body || " "));
				editor.tf.deselect();
				editor.tf.setValue(value);
			} finally {
				// Slate flushes onChange in a microtask; release the guard after it
				// has run so the reload never marks the document dirty.
				window.setTimeout(() => {
					externalReloadRef.current = false;
				}, 0);
			}
			savedRef.current = markdown;
			setDirty(false);
			// Re-seed asset ref-counts so the reload does not GC images that only
			// existed in the replaced value.
			imageCountsRef.current = collectImageUrlCounts(editor.children);
			return true;
		},
		[editor, setDirty, debouncedPersist],
	);

	const onFrontmatterChange = useCallback(
		(interior: string) => {
			setFrontmatterYaml(interior);
			frontmatterRef.current = wrapFrontmatter(interior);
			schedulePersist();
		},
		[schedulePersist],
	);

	const saveNow = useCallback(() => {
		debouncedPersist.cancel();
		reconcileAssetsRef.current();
		persistRef.current();
	}, [debouncedPersist]);

	return {
		frontmatterYaml,
		onFrontmatterChange,
		serialize,
		noteDocumentChanged: schedulePersist,
		saveNow,
		applyExternalMarkdown,
		savedRef,
		dirtyRef,
	};
}
