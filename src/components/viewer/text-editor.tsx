import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useTheme } from "next-themes";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useTextEditorFontSize } from "@/components/viewer/hooks/use-text-editor-font-size";
import { AskPopover } from "@/components/viewer/pdf/cards/ask-popover";
import { SelectionMenu } from "@/components/viewer/pdf/cards/selection-menu";
import { textLanguageExtensions } from "@/components/viewer/text-editor-language";
import {
	type EditorDiagnostic,
	lintDiagnosticsWatcher,
	TextEditorLintFooter,
} from "@/components/viewer/text-editor-lint-footer";
import { TextEditorToolbar } from "@/components/viewer/text-editor-toolbar";
import { useTextEditorSelection } from "@/components/viewer/use-text-editor-selection";
import { basenameOf } from "@/lib/core/path";
import { registerTextEditorFlusher } from "@/lib/workspace/text-editor-flush";
import { textLanguageIdForPath } from "@/lib/workspace/viewer";

interface TextEditorProps {
	seed: string;
	path: string;
	reloadKey: number;
	onPersist: (
		path: string,
		content: string,
		lastSaved: string,
	) => Promise<boolean>;
	onDirtyChange: (dirty: boolean) => void;
	/** Manual save (⌘S) after the flush landed — TeX compiles here. */
	onManualSave?: (path: string) => void;
	/** Whether the owning tab is the active panel — gates the selection toolbar. */
	active?: boolean;
	className?: string;
}

const AUTOSAVE_DELAY_MS = 800;
const LatexPreview = lazy(() => import("./latex-preview"));

// Base chrome rides the app's shadcn design tokens so light/dark both blend
// with the surrounding surface; syntax colors come from the default light
// highlight style / oneDark (swapped via compartment). Placed after oneDark
// so the transparent background wins over its solid panel color.
const baseTheme = EditorView.theme({
	"&": {
		height: "100%",
		backgroundColor: "transparent",
		color: "var(--foreground)",
	},
	".cm-scroller": {
		fontFamily: "var(--font-mono)",
		lineHeight: "1.65",
	},
	".cm-gutters": {
		backgroundColor: "transparent",
		color: "var(--muted-foreground)",
		borderRight: "1px solid var(--border)",
	},
	".cm-activeLine": {
		backgroundColor: "color-mix(in oklab, var(--muted) 45%, transparent)",
	},
	".cm-activeLineGutter": {
		backgroundColor: "color-mix(in oklab, var(--muted) 60%, transparent)",
	},
	".cm-content": { caretColor: "var(--foreground)" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
	"&.cm-focused": { outline: "none" },
});

/**
 * Plain-text / code editor (CodeMirror 6) for the `text` fallback mode.
 * Same lifecycle contract as ExcalidrawViewer: React props seed the document
 * and signal external reloads (`reloadKey`); live content, dirty state and
 * debounced autosave are owned here and flow out via callbacks. Unlike the
 * Excalidraw viewer a reload swaps the document in place — view, scroll and
 * undo history are not thrown away.
 */
export function TextEditor({
	seed,
	path,
	reloadKey,
	onPersist,
	onDirtyChange,
	onManualSave,
	active = true,
	className,
}: TextEditorProps) {
	const { t } = useTranslation("common");
	const isTex = /\.tex$/i.test(path);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewSource, setPreviewSource] = useState(seed);
	const previewEnabledRef = useRef(false);
	previewEnabledRef.current = isTex && previewOpen;
	const togglePreview = () => {
		setPreviewSource(viewRef.current?.state.doc.toString() ?? seedRef.current);
		setPreviewOpen((open) => !open);
	};
	// Font size managed by hook with process-wide persistence (like PDF paper tone).
	const { fontSize, setFontSize } = useTextEditorFontSize();

	// Follow the app theme (system / light / dark preference via next-themes).
	const { resolvedTheme } = useTheme();
	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const themeCompartment = useRef(new Compartment());
	const languageCompartment = useRef(new Compartment());
	const fontSizeCompartment = useRef(new Compartment());
	const lastSavedRef = useRef(seed);
	const pendingContentRef = useRef<string | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dirtyRef = useRef(false);

	// Latest seed for the reload effect without re-mounting the editor.
	const seedRef = useRef(seed);
	seedRef.current = seed;
	// Initial language/theme are read at mount; later changes go through the
	// reconfigure effects below (mounting must stay once-per-tab).
	const pathRef = useRef(path);
	pathRef.current = path;
	const themeRef = useRef(resolvedTheme);
	themeRef.current = resolvedTheme;
	const fontSizeRef = useRef(fontSize);
	fontSizeRef.current = fontSize;

	// Keep callbacks stable across parent re-renders (doc-view passes inline
	// arrows for `onDirtyChange`).
	const onDirtyChangeRef = useRef(onDirtyChange);
	onDirtyChangeRef.current = onDirtyChange;

	// True when disk is current after the flush (nothing pending, or the save
	// landed); false when the save was refused (conflict guard / write error).
	const flush = useCallback(async (): Promise<boolean> => {
		const content = pendingContentRef.current;
		if (content == null) return true;
		pendingContentRef.current = null;
		const ok = await onPersist(path, content, lastSavedRef.current);
		if (ok) {
			lastSavedRef.current = content;
			dirtyRef.current = false;
			onDirtyChangeRef.current(false);
		}
		return ok;
	}, [onPersist, path]);

	const schedulePersist = useCallback(
		(content: string) => {
			pendingContentRef.current = content;
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => {
				debounceRef.current = null;
				void flush();
			}, AUTOSAVE_DELAY_MS);
		},
		[flush],
	);

	// The update listener is registered once at mount; route it through a ref
	// so a path change (rename) keeps saving to the current file.
	const schedulePersistRef = useRef(schedulePersist);
	schedulePersistRef.current = schedulePersist;

	// Manual save (⌘S / Ctrl+S) rides the CodeMirror keymap (only when the
	// editor is focused, same as its other bindings): flush immediately,
	// skipping the debounce, then fire the hook — the TeX path compiles there.
	// A clean buffer still fires it (explicit rebuild, Overleaf-style); a
	// refused save (conflict guard) does not — compiling the disk copy would
	// mislead. Routed through refs since the keymap registers once at mount.
	const flushRef = useRef(flush);
	flushRef.current = flush;
	const onManualSaveRef = useRef(onManualSave);
	onManualSaveRef.current = onManualSave;
	const manualSaveKeymap = useMemo(
		() => [
			{
				key: "Mod-s",
				preventDefault: true,
				run: () => {
					void flushRef.current().then((ok) => {
						if (ok) onManualSaveRef.current?.(pathRef.current);
					});
					return true;
				},
			},
		],
		[],
	);

	// Selection → floating Quick chat / Add to chat toolbar (same chrome the
	// PDF surfaces have). The listener extension registers once at mount and
	// routes through refs inside the hook.
	const selection = useTextEditorSelection({ viewRef, path, active });

	// Lint diagnostics for the status-bar footer (TeX only — the only mode
	// with lint sources). The watcher extension registers once at mount and
	// pushes the merged findings after every lint run.
	const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([]);
	const handleDiagnostics = useCallback((next: EditorDiagnostic[]) => {
		setDiagnostics(next);
	}, []);
	const hasLintSources = useMemo(
		() => textLanguageIdForPath(path) === "tex",
		[path],
	);
	const jumpToDiagnostic = useCallback((diagnostic: EditorDiagnostic) => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			selection: { anchor: diagnostic.from, head: diagnostic.to },
			scrollIntoView: true,
		});
		view.focus();
	}, []);

	// Expose the flush to lib actions: the compile button builds disk bytes,
	// so it must first land this editor's debounced autosave.
	useEffect(() => registerTextEditorFlusher(path, flush), [path, flush]);

	// Editor owns its state: mount once, reconfigure language/theme in place.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const language = textLanguageExtensions(pathRef.current);
		const extensions: Extension[] = [
			basicSetup,
			EditorView.lineWrapping,
			keymap.of(manualSaveKeymap),
			selection.selectionListener,
			lintDiagnosticsWatcher(handleDiagnostics),
			languageCompartment.current.of(language),
			themeCompartment.current.of(themeRef.current === "dark" ? oneDark : []),
			fontSizeCompartment.current.of(
				EditorView.theme({ "&": { fontSize: `${fontSizeRef.current}px` } }),
			),
			baseTheme,
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				if (!dirtyRef.current) {
					dirtyRef.current = true;
					onDirtyChangeRef.current(true);
				}
				const content = update.state.doc.toString();
				if (previewEnabledRef.current) setPreviewSource(content);
				schedulePersistRef.current(content);
			}),
		];
		const view = new EditorView({
			parent: host,
			state: EditorState.create({ doc: seedRef.current, extensions }),
		});
		viewRef.current = view;
		return () => {
			view.destroy();
			viewRef.current = null;
		};
		// Mount-once; seed/path/theme changes are handled by the effects below
		// (`manualSaveKeymap` / `selection.selectionListener` /
		// `handleDiagnostics` are stable — never re-mount the editor).
	}, [manualSaveKeymap, selection.selectionListener, handleDiagnostics]);

	// Follow theme switches without rebuilding the editor.
	useEffect(() => {
		viewRef.current?.dispatch({
			effects: themeCompartment.current.reconfigure(
				resolvedTheme === "dark" ? oneDark : [],
			),
		});
	}, [resolvedTheme]);

	// Follow fontSize changes without rebuilding the editor.
	useEffect(() => {
		viewRef.current?.dispatch({
			effects: fontSizeCompartment.current.reconfigure(
				EditorView.theme({ "&": { fontSize: `${fontSize}px` } }),
			),
		});
	}, [fontSize]);

	// A renamed path only swaps the language support.
	const language = useMemo(() => textLanguageExtensions(path), [path]);
	useEffect(() => {
		viewRef.current?.dispatch({
			effects: languageCompartment.current.reconfigure(language),
		});
	}, [language]);

	// The seed is authoritative: after our own save it equals what we wrote
	// (idempotent), after an external change it is the new disk snapshot.
	useEffect(() => {
		lastSavedRef.current = seed;
	}, [seed]);

	// Flush pending autosave on unmount (tab close / LRU eviction).
	useEffect(() => {
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
			}
			if (pendingContentRef.current) {
				void flush();
			}
		};
	}, [flush]);

	// A `reloadKey` bump means the file was reloaded from disk (external
	// change the user accepted). Drop any pending autosave from the superseded
	// session — its flush would pass the conflict check (disk === lastSaved)
	// and overwrite the reloaded content — and swap the document in place.
	useEffect(() => {
		if (reloadKey === 0) return; // mount: document was seeded directly
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
			debounceRef.current = null;
		}
		pendingContentRef.current = null;
		const view = viewRef.current;
		const next = seedRef.current;
		lastSavedRef.current = next;
		if (view && view.state.doc.toString() !== next) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: next },
			});
		}
		dirtyRef.current = false;
		onDirtyChangeRef.current(false);
	}, [reloadKey]);

	// An unreadable file still opens an empty buffer — the next autosave
	// creates/repairs the file on disk.
	// The selection chrome portals to body so the fixed-position toolbar and
	// Ask popover escape the panel's overflow/stacking context (same as the
	// PDF card stack); inactive keep-alive panes render no chrome.
	return (
		<div
			className={`group @container relative flex h-full w-full flex-col overflow-hidden ${className ?? ""}`}
		>
			<TextEditorToolbar
				fontSize={fontSize}
				onFontSizeChange={setFontSize}
				previewOpen={previewOpen && isTex}
				onTogglePreview={isTex ? togglePreview : undefined}
			/>
			<div className="flex min-h-0 flex-1 flex-col @min-[640px]:flex-row">
				<div ref={hostRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" />
				{isTex && previewOpen ? (
					<div className="min-h-0 min-w-0 flex-1 overflow-hidden border-t @min-[640px]:border-t-0 @min-[640px]:border-l">
						<Suspense
							fallback={
								<p className="p-6 text-muted-foreground text-sm">
									{t("loading")}
								</p>
							}
						>
							<LatexPreview source={previewSource} />
						</Suspense>
					</div>
				) : null}
			</div>
			{hasLintSources ? (
				<TextEditorLintFooter
					diagnostics={diagnostics}
					onJump={jumpToDiagnostic}
				/>
			) : null}
			{active
				? createPortal(
						<>
							{selection.menu && !selection.ask ? (
								<SelectionMenu
									screen={selection.menu.screen}
									onHighlight={() => undefined}
									onAsk={selection.handleAsk}
									onAddToChat={selection.handleAddToChat}
									onTranslate={() => undefined}
									showHighlight={false}
									showTranslate={false}
								/>
							) : null}
							{selection.ask ? (
								<AskPopover
									thread={selection.ask.thread}
									paperTitle={basenameOf(path)}
									screen={selection.ask.screen}
									streaming={selection.streaming}
									error={selection.askError}
									onSend={selection.sendAskQuestion}
									onResend={selection.resendAskQuestion}
									onHide={selection.hideAsk}
									onDelete={selection.deleteAsk}
									onStop={selection.stopAskStreaming}
								/>
							) : null}
						</>,
						document.body,
					)
				: null}
		</div>
	);
}
