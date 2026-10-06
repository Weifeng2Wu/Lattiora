import { FileText, FolderPlus } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/use-app-stores";
import { cn } from "@/lib/core/utils";
import { isValidVaultEntryName } from "@/lib/vault";
import { fileNameSuffix } from "./tree-helpers";
import type { TreeCreateKind } from "./types";

/** Inline name input — VS Code / Cursor style create. */
export function TreeCreateInput({
	kind,
	onConfirm,
	onCancel,
}: {
	kind: TreeCreateKind;
	onConfirm: (name: string) => void;
	onCancel: () => void;
	/** Absolute path of the parent directory. */
	parentPath?: string;
	/** Vault root absolute path. */
	vaultRoot?: string;
}) {
	const { t } = useTranslation("sidebar");
	const allowFileExtensionRename = useSettings(
		(s) => s.allowFileExtensionRename,
	);
	const defaultName =
		kind === "excalidraw"
			? `${t("fileTree.untitled")}.excalidraw`
			: kind === "mindmap" || kind === "kanban"
				? `${t("fileTree.untitled")}.${kind}.json`
				: kind === "file"
					? allowFileExtensionRename
						? `${t("fileTree.untitled")}.md`
						: t("fileTree.untitled")
					: t("fileTree.newFolder");
	const [value, setValue] = useState(defaultName);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const committedRef = useRef(false);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		if (kind === "excalidraw") {
			el.setSelectionRange(0, defaultName.length - ".excalidraw".length);
		} else if (kind === "mindmap" || kind === "kanban") {
			el.setSelectionRange(0, defaultName.length - `.${kind}.json`.length);
		} else if (kind === "file") {
			if (allowFileExtensionRename) {
				// Select the basename while retaining the suggested extension.
				const dot = defaultName.lastIndexOf(".");
				if (dot > 0) el.setSelectionRange(0, dot);
				else el.select();
			} else {
				// Extension editing is off; the create action supplies .md.
				el.select();
			}
		} else {
			el.select();
		}
	}, [kind, defaultName, allowFileExtensionRename]);

	const commit = useCallback(() => {
		if (committedRef.current) return;
		const name = value.trim();
		if (!name) {
			committedRef.current = true;
			onCancel();
			return;
		}
		if (!isValidVaultEntryName(name)) {
			setError(t("fileTree.invalidName"));
			// Keep editing; re-focus next tick.
			requestAnimationFrame(() => inputRef.current?.focus());
			return;
		}
		committedRef.current = true;
		onConfirm(name);
	}, [value, onCancel, onConfirm, t]);

	const cancel = useCallback(() => {
		if (committedRef.current) return;
		committedRef.current = true;
		onCancel();
	}, [onCancel]);

	const Icon = kind === "folder" ? FolderPlus : FileText;

	// Match virtualized row height (estimateSize ≈ 28px / h-7). Extra outer
	// padding or an in-flow error line used to measure taller than siblings;
	// after draft removal the virtualizer kept that size by index and left a gap.
	return (
		<div className="relative">
			<div
				className={cn(
					"flex h-7 items-center gap-1 rounded px-4",
					error ? "bg-destructive/10" : "bg-muted/60",
				)}
			>
				<Icon className="size-4 shrink-0 text-muted-foreground" />
				<input
					ref={inputRef}
					type="text"
					value={value}
					title={error ?? undefined}
					aria-label={
						kind === "excalidraw"
							? t("fileTree.newExcalidraw")
							: kind === "mindmap"
								? t("fileTree.newMindMap")
								: kind === "kanban"
									? t("fileTree.newKanban")
									: kind === "file"
										? t("fileTree.newFile")
										: t("fileTree.newFolder")
					}
					aria-invalid={Boolean(error)}
					className={cn(
						"h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-sm outline-none",
						error && "border-destructive",
					)}
					onChange={(e) => {
						setValue(e.target.value);
						if (error) setError(null);
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.nativeEvent.isComposing) return;
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							cancel();
						}
					}}
					onBlur={() => {
						// Defer so Enter/click handlers run first.
						requestAnimationFrame(() => {
							if (!committedRef.current) commit();
						});
					}}
				/>
			</div>
			{error ? (
				<p className="pointer-events-none absolute top-full right-0 left-8 z-10 mt-0.5 rounded bg-background/95 px-1 text-destructive text-caption leading-tight shadow-sm">
					{error}
				</p>
			) : null}
		</div>
	);
}

/** Inline name input for renaming a file/folder (VS Code / Finder style). */
export function TreeRenameInput({
	initialName,
	isFile,
	icon,
	onConfirm,
	onCancel,
}: {
	initialName: string;
	isFile: boolean;
	icon: ReactNode;
	onConfirm: (name: string) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation("sidebar");
	const allowFileExtensionRename = useSettings(
		(s) => s.allowFileExtensionRename,
	);
	// Keep the editing mode stable for this draft, including across settings sync.
	const [suffix] = useState(() => {
		if (!isFile || allowFileExtensionRename) return "";
		return fileNameSuffix(initialName);
	});
	const [value, setValue] = useState(() =>
		initialName.slice(0, initialName.length - suffix.length),
	);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const committedRef = useRef(false);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		el.select();
	}, []);

	const commit = useCallback(() => {
		if (committedRef.current) return;
		const name = value.trim();
		if (!name) {
			committedRef.current = true;
			onCancel();
			return;
		}
		if (!isValidVaultEntryName(name)) {
			setError(t("fileTree.invalidName"));
			requestAnimationFrame(() => inputRef.current?.focus());
			return;
		}
		const nextName = `${name}${suffix}`;
		if (nextName === initialName) {
			committedRef.current = true;
			onCancel();
			return;
		}
		committedRef.current = true;
		onConfirm(nextName);
	}, [value, suffix, initialName, onCancel, onConfirm, t]);

	const cancel = useCallback(() => {
		if (committedRef.current) return;
		committedRef.current = true;
		onCancel();
	}, [onCancel]);

	return (
		<div className="relative">
			<div
				className={cn(
					"flex h-7 items-center gap-1 rounded px-4",
					error ? "bg-destructive/10" : "bg-muted/60",
				)}
			>
				{icon}
				<input
					ref={inputRef}
					type="text"
					value={value}
					title={error ?? undefined}
					aria-label={t("fileTree.rename")}
					aria-invalid={Boolean(error)}
					className={cn(
						"h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-sm outline-none",
						error && "border-destructive",
					)}
					onChange={(e) => {
						setValue(e.target.value);
						if (error) setError(null);
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.nativeEvent.isComposing) return;
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							cancel();
						}
					}}
					onBlur={() => {
						requestAnimationFrame(() => {
							if (!committedRef.current) commit();
						});
					}}
				/>
			</div>
			{error ? (
				<p className="pointer-events-none absolute top-full right-0 left-8 z-10 mt-0.5 rounded bg-background/95 px-1 text-destructive text-caption leading-tight shadow-sm">
					{error}
				</p>
			) : null}
		</div>
	);
}
