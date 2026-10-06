import { Check, Download, Redo2, Save, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextEditor } from "@/components/viewer/text-editor";
import { notifyError } from "@/lib/core/notify";
import { basenameOf } from "@/lib/core/path";
import { registerTextEditorFlusher } from "@/lib/workspace/text-editor-flush";
import { VisualDocumentSave } from "@/lib/workspace/visual-document-save";
import {
	parseVisualDocument,
	type VisualDocument,
	visualDocumentKind,
} from "@/lib/workspace/visual-documents";
import { IconButton } from "./controls";
import { KanbanEditor } from "./kanban";
import { MindMapEditor } from "./mind-map";

type Props = {
	path: string;
	seed: string;
	reloadKey: number;
	active?: boolean;
	className?: string;
	onPersist: (
		path: string,
		content: string,
		expected: string,
	) => Promise<boolean>;
	onDirtyChange: (dirty: boolean) => void;
};

export function VisualDocumentEditor(props: Props) {
	const { t } = useTranslation("viewer");
	const initial = useMemo(() => {
		try {
			const kind = visualDocumentKind(props.path);
			return kind ? parseVisualDocument(props.seed, kind) : null;
		} catch {
			return null;
		}
	}, [props.seed, props.path]);
	if (!initial)
		return (
			<div className="flex h-full flex-col">
				<p className="border-b p-3 text-muted-foreground text-sm">
					{t("visual.invalidFile")}
				</p>
				<div className="min-h-0 flex-1">
					<TextEditor {...props} />
				</div>
			</div>
		);
	return <VisualEditorSession {...props} initial={initial} />;
}

function VisualEditorSession({
	initial,
	...props
}: Props & { initial: VisualDocument }) {
	const { t } = useTranslation("viewer");
	const [doc, setDoc] = useState(initial);
	const [dirty, setDirty] = useState(false);
	const [history, setHistory] = useState<{
		past: VisualDocument[];
		future: VisualDocument[];
	}>({ past: [], future: [] });
	const latest = useRef(props);
	latest.current = props;
	const documentRef = useRef(doc);
	documentRef.current = doc;
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [writer] = useState(
		() =>
			new VisualDocumentSave(
				props.seed,
				(content, expected) =>
					latest.current.onPersist(latest.current.path, content, expected),
				(value) => {
					setDirty(value);
					latest.current.onDirtyChange(value);
				},
			),
	);
	const flush = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		return writer.flush();
	}, [writer]);
	const apply = (next: VisualDocument) => {
		documentRef.current = next;
		setDoc(next);
		writer.change(`${JSON.stringify(next, null, 2)}\n`);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			void flush();
		}, 400);
	};
	const change = (next: VisualDocument) => {
		if (next === doc) return;
		setHistory({ past: [...history.past.slice(-49), doc], future: [] });
		apply(next);
	};
	const undo = () => {
		const previous = history.past.at(-1);
		if (!previous) return;
		setHistory({
			past: history.past.slice(0, -1),
			future: [doc, ...history.future],
		});
		apply(previous);
	};
	const redo = () => {
		const next = history.future[0];
		if (!next) return;
		setHistory({
			past: [...history.past, doc],
			future: history.future.slice(1),
		});
		apply(next);
	};
	const reload = useRef(props.reloadKey);
	useEffect(() => {
		if (reload.current === props.reloadKey) return;
		reload.current = props.reloadKey;
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		writer.reset(props.seed);
		setDoc(initial);
		setHistory({ past: [], future: [] });
	}, [props.reloadKey, props.seed, initial, writer]);
	useEffect(
		() => registerTextEditorFlusher(props.path, flush),
		[props.path, flush],
	);
	useEffect(() => {
		const onHide = () => {
			if (document.visibilityState === "hidden") void flush();
		};
		const onUnload = (event: BeforeUnloadEvent) => {
			if (!writer.isDirty) return;
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
	const download = () => {
		try {
			const url = URL.createObjectURL(
				new Blob([`${JSON.stringify(documentRef.current, null, 2)}\n`], {
					type: "application/json",
				}),
			);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = basenameOf(props.path);
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch {
			notifyError(t("visual.exportFailed"));
		}
	};
	return (
		<fieldset
			className="m-0 flex h-full min-w-0 flex-col border-0 p-0"
			aria-label={t(
				doc.type === "mindmap" ? "visual.mindmap" : "visual.kanban",
			)}
			onKeyDown={(event) => {
				if (event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey))
					return;
				if (event.key.toLowerCase() === "s") {
					event.preventDefault();
					event.stopPropagation();
					void flush();
				}
				// Inputs keep native text undo; the toolbar always exposes document undo.
				if (
					event.target instanceof HTMLInputElement ||
					event.target instanceof HTMLTextAreaElement
				)
					return;
				if (event.key.toLowerCase() === "z") {
					event.preventDefault();
					event.stopPropagation();
					if (event.shiftKey) redo();
					else undo();
				}
			}}
		>
			<div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
				<span className="mr-2 text-muted-foreground text-xs">
					{t(doc.type === "mindmap" ? "visual.mindmap" : "visual.kanban")}
				</span>
				<IconButton
					label={t("visual.undo")}
					disabled={!history.past.length}
					onClick={undo}
				>
					<Undo2 className="size-4" />
				</IconButton>
				<IconButton
					label={t("visual.redo")}
					disabled={!history.future.length}
					onClick={redo}
				>
					<Redo2 className="size-4" />
				</IconButton>
				<div className="flex-1" />
				<IconButton
					label={t(dirty ? "visual.save" : "visual.saved")}
					disabled={!dirty}
					onClick={() => void flush()}
				>
					{dirty ? (
						<Save className="size-4" />
					) : (
						<Check className="size-4 text-muted-foreground" />
					)}
				</IconButton>
				<IconButton label={t("visual.export")} onClick={download}>
					<Download className="size-4" />
				</IconButton>
			</div>
			{doc.type === "mindmap" ? (
				<MindMapEditor doc={doc} onChange={change} />
			) : (
				<KanbanEditor doc={doc} onChange={change} />
			)}
		</fieldset>
	);
}
