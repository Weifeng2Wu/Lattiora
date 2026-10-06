import {
	Excalidraw,
	Footer,
	hashElementsVersion,
	restore,
	serializeAsJSON,
	serializeLibraryAsJSON,
	useHandleLibrary,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
	ExcalidrawImperativeAPI,
	ExcalidrawInitialDataState,
	ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import { Check, Save } from "lucide-react";
import { useTheme } from "next-themes";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { TextEditor } from "@/components/viewer/text-editor";
import { IconButton } from "@/components/viewer/visual/controls";
import {
	readExcalidrawLibrary,
	writeExcalidrawLibrary,
} from "@/lib/cloud/excalidraw-library";
import { notifyError } from "@/lib/core/notify";
import { basenameOf } from "@/lib/core/path";
import { parseExcalidrawDocument } from "@/lib/workspace/excalidraw-document";
import { registerTextEditorFlusher } from "@/lib/workspace/text-editor-flush";
import { VisualDocumentSave } from "@/lib/workspace/visual-document-save";

type Props = {
	seed: string;
	path: string;
	reloadKey: number;
	onPersist: (
		path: string,
		content: string,
		lastSaved: string,
	) => Promise<boolean>;
	onDirtyChange: (dirty: boolean) => void;
	className?: string;
};

export function ExcalidrawViewer(props: Props) {
	const { t } = useTranslation("viewer");
	const initial = useMemo(() => {
		try {
			return parseExcalidrawDocument(props.seed);
		} catch {
			return null;
		}
	}, [props.seed]);
	if (!initial)
		return (
			<div className="flex h-full flex-col">
				<p className="border-b p-3 text-muted-foreground text-sm">
					{t("excalidraw.invalidFile")}
				</p>
				<div className="min-h-0 flex-1">
					<TextEditor {...props} />
				</div>
			</div>
		);
	return <ExcalidrawSession {...props} initial={initial} />;
}

function ExcalidrawSession({
	initial,
	...props
}: Props & { initial: ExcalidrawInitialDataState }) {
	const { t, i18n } = useTranslation("viewer");
	const { resolvedTheme } = useTheme();
	const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
	useHandleLibrary({ excalidrawAPI: api });
	const translate = useRef(t);
	translate.current = t;
	const latest = useRef(props);
	latest.current = props;
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [dirty, setDirty] = useState(false);
	const [libraryDirty, setLibraryDirty] = useState(false);
	const [library, setLibrary] = useState<Awaited<
		ReturnType<typeof readExcalidrawLibrary>
	> | null>(null);
	const [libraryFailed, setLibraryFailed] = useState(false);
	const libraryWriter = useRef<VisualDocumentSave | null>(null);
	const lastScene = useRef<string | null>(null);
	const pendingScene = useRef<Parameters<
		NonNullable<ExcalidrawProps["onChange"]>
	> | null>(null);
	const lastLibrary = useRef<string | null>(null);
	const [writer] = useState(
		() =>
			new VisualDocumentSave(
				props.seed,
				(content, expected) =>
					latest.current.onPersist(latest.current.path, content, expected),
				(value) => {
					const dirty = value || pendingScene.current !== null;
					setDirty(dirty);
					latest.current.onDirtyChange(dirty);
				},
			),
	);
	const loadLibrary = useCallback(async () => {
		try {
			const loaded = await readExcalidrawLibrary();
			lastLibrary.current = serializeLibraryAsJSON(loaded.items);
			libraryWriter.current = new VisualDocumentSave(
				loaded.seed,
				async (content, expected) => {
					try {
						await writeExcalidrawLibrary(content, expected);
						return true;
					} catch {
						notifyError(translate.current("excalidraw.librarySaveFailed"));
						return false;
					}
				},
				setLibraryDirty,
			);
			setLibrary(loaded);
			setLibraryFailed(false);
		} catch {
			setLibraryFailed(true);
			notifyError(translate.current("excalidraw.libraryLoadFailed"));
		}
	}, []);
	useEffect(() => {
		void loadLibrary();
	}, [loadLibrary]);

	const flush = useCallback(async () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		const scene = pendingScene.current;
		pendingScene.current = null;
		if (scene) writer.change(serializeAsJSON(...scene, "local"));
		const results = await Promise.all([
			writer.flush(),
			libraryWriter.current?.flush() ?? true,
		]);
		return results.every(Boolean);
	}, [writer]);
	const schedule = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			void flush();
		}, 800);
	}, [flush]);
	const reload = useRef(props.reloadKey);
	useLayoutEffect(() => {
		if (reload.current === props.reloadKey) return;
		reload.current = props.reloadKey;
		pendingScene.current = null;
		writer.reset(props.seed);
		lastScene.current = null;
	}, [props.reloadKey, props.seed, writer]);
	useEffect(
		() => registerTextEditorFlusher(props.path, flush),
		[props.path, flush],
	);
	useEffect(() => {
		const onHide = () => {
			if (document.visibilityState === "hidden") void flush();
		};
		const onUnload = (event: BeforeUnloadEvent) => {
			if (
				!pendingScene.current &&
				!writer.isDirty &&
				!libraryWriter.current?.isDirty
			)
				return;
			void flush();
			event.preventDefault();
		};
		document.addEventListener("visibilitychange", onHide);
		window.addEventListener("beforeunload", onUnload);
		return () => {
			document.removeEventListener("visibilitychange", onHide);
			window.removeEventListener("beforeunload", onUnload);
			void flush();
		};
	}, [writer, flush]);
	const onChange: NonNullable<ExcalidrawProps["onChange"]> = useCallback(
		(elements, appState, files) => {
			// Cursor/selection updates must not repeatedly stringify embedded images.
			const fingerprint = (
				scene: Parameters<NonNullable<ExcalidrawProps["onChange"]>>,
			): string =>
				`${hashElementsVersion(scene[0])}:${serializeAsJSON([], scene[1], {}, "local")}:${Object.keys(scene[2]).sort().join(",")}`;
			const scene: Parameters<NonNullable<ExcalidrawProps["onChange"]>> = [
				elements,
				appState,
				files,
			];
			const key = fingerprint(scene);
			if (lastScene.current === null) {
				const restored = restore(initial, null, null);
				lastScene.current = `${hashElementsVersion(restored.elements)}:${serializeAsJSON([], restored.appState, {}, "local")}:${Object.keys(restored.files).sort().join(",")}`;
			}
			if (lastScene.current === key) return;
			lastScene.current = key;
			pendingScene.current = scene;
			setDirty(true);
			latest.current.onDirtyChange(true);
			schedule();
		},
		[initial, schedule],
	);
	const onLibraryChange: NonNullable<ExcalidrawProps["onLibraryChange"]> =
		useCallback(
			(items) => {
				const content = serializeLibraryAsJSON(items);
				if (!libraryWriter.current || lastLibrary.current === content) return;
				lastLibrary.current = content;
				libraryWriter.current.change(content);
				schedule();
			},
			[schedule],
		);

	return (
		<fieldset
			className={`m-0 h-full min-w-0 border-0 p-0 ${props.className ?? ""}`}
			aria-label={t("excalidraw.canvas")}
			onKeyDownCapture={(event) => {
				if (
					event.nativeEvent.isComposing ||
					!(event.ctrlKey || event.metaKey) ||
					event.shiftKey ||
					event.key.toLowerCase() !== "s"
				)
					return;
				event.preventDefault();
				event.stopPropagation();
				void flush();
			}}
		>
			{library ? (
				<Excalidraw
					excalidrawAPI={setApi}
					key={props.reloadKey}
					initialData={{ ...initial, libraryItems: library.items }}
					onChange={onChange}
					onLibraryChange={onLibraryChange}
					theme={resolvedTheme === "dark" ? "dark" : "light"}
					langCode={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
					name={basenameOf(props.path).replace(/\.excalidraw$/i, "")}
					UIOptions={{ canvasActions: { toggleTheme: false } }}
				>
					<Footer>
						<IconButton
							label={t(dirty || libraryDirty ? "visual.save" : "visual.saved")}
							disabled={!dirty && !libraryDirty}
							onClick={() => void flush()}
						>
							{dirty || libraryDirty ? (
								<Save className="size-4" />
							) : (
								<Check className="size-4" />
							)}
						</IconButton>
					</Footer>
				</Excalidraw>
			) : libraryFailed ? (
				<button
					type="button"
					className="m-4 rounded border px-3 py-2"
					onClick={() => void loadLibrary()}
				>
					{t("excalidraw.retry")}
				</button>
			) : null}
		</fieldset>
	);
}
