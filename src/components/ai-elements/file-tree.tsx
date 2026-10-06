"use client";

import {
	ChevronRightIcon,
	FileIcon,
	FolderIcon,
	FolderOpenIcon,
} from "lucide-react";
import type {
	DragEvent,
	HTMLAttributes,
	KeyboardEvent,
	MouseEvent,
	ReactNode,
} from "react";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { cn } from "@/lib/core/utils";

export type SelectMods = { meta: boolean; ctrl: boolean; shift: boolean };

interface FileTreeContextType {
	expandedPaths: Set<string>;
	togglePath: (path: string) => void;
	selectedPath?: string;
	onSelect?: (path: string) => void;
	onDoubleClickPath?: (path: string) => void;
	onContextMenuPath?: (path: string, event: MouseEvent) => void;
	/** Multi-selection set (row highlight). No checkboxes — modifier-click only. */
	selectedPaths?: Set<string>;
	/** Row click carrying modifier keys (files + modifier-clicked folders). */
	onSelectRow?: (path: string, mods: SelectMods) => void;
	/** Drag-and-drop to move: current drop-target row (highlight) + callbacks. */
	dropTargetPath?: string | null;
	onRowDragStart?: (path: string, e: DragEvent) => void;
	onRowDragOver?: (path: string, e: DragEvent) => void;
	onRowDrop?: (path: string, e: DragEvent) => void;
	onRowDragEnd?: () => void;
}

const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
	expandedPaths: new Set(),
	togglePath: noop,
});

export function useFileTree(): FileTreeContextType {
	return useContext(FileTreeContext);
}

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
	expanded?: Set<string>;
	defaultExpanded?: Set<string>;
	selectedPath?: string;
	onSelect?: (path: string) => void;
	/** Double-click a tree row (file or folder). */
	onDoubleClickPath?: (path: string) => void;
	/** Right-click a tree row (file or folder). */
	onContextMenuPath?: (path: string, event: MouseEvent) => void;
	onExpandedChange?: (expanded: Set<string>) => void;
	selectedPaths?: Set<string>;
	onSelectRow?: (path: string, mods: SelectMods) => void;
	dropTargetPath?: string | null;
	onRowDragStart?: (path: string, e: DragEvent) => void;
	onRowDragOver?: (path: string, e: DragEvent) => void;
	onRowDrop?: (path: string, e: DragEvent) => void;
	onRowDragEnd?: () => void;
};

export const FileTree = ({
	expanded: controlledExpanded,
	defaultExpanded,
	selectedPath,
	onSelect,
	onDoubleClickPath,
	onContextMenuPath,
	selectedPaths,
	onSelectRow,
	dropTargetPath,
	onRowDragStart,
	onRowDragOver,
	onRowDrop,
	onRowDragEnd,
	onExpandedChange,
	className,
	children,
	...props
}: FileTreeProps) => {
	const [internalExpanded, setInternalExpanded] = useState<Set<string>>(
		() => defaultExpanded ?? new Set(),
	);
	const expandedPaths = controlledExpanded ?? internalExpanded;

	const togglePath = useCallback(
		(path: string) => {
			const base = controlledExpanded ?? internalExpanded;
			const newExpanded = new Set(base);
			if (newExpanded.has(path)) {
				newExpanded.delete(path);
			} else {
				newExpanded.add(path);
			}
			if (!controlledExpanded) {
				setInternalExpanded(newExpanded);
			}
			onExpandedChange?.(newExpanded);
		},
		[controlledExpanded, internalExpanded, onExpandedChange],
	);

	const contextValue = useMemo(
		() => ({
			expandedPaths,
			onSelect,
			onDoubleClickPath,
			onContextMenuPath,
			selectedPath,
			selectedPaths,
			onSelectRow,
			dropTargetPath,
			onRowDragStart,
			onRowDragOver,
			onRowDrop,
			onRowDragEnd,
			togglePath,
		}),
		[
			expandedPaths,
			onSelect,
			onDoubleClickPath,
			onContextMenuPath,
			selectedPath,
			selectedPaths,
			onSelectRow,
			dropTargetPath,
			onRowDragStart,
			onRowDragOver,
			onRowDrop,
			onRowDragEnd,
			togglePath,
		],
	);

	return (
		<FileTreeContext.Provider value={contextValue}>
			<div
				className={cn("text-sm", className)}
				role="tree"
				aria-multiselectable={Boolean(onSelectRow)}
				{...props}
			>
				{children}
			</div>
		</FileTreeContext.Provider>
	);
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
	className,
	children,
	...props
}: FileTreeIconProps) => (
	<span className={cn("shrink-0", className)} {...props}>
		{children}
	</span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
	className,
	children,
	...props
}: FileTreeNameProps) => (
	<span className={cn("truncate", className)} {...props}>
		{children}
	</span>
);

/**
 * Keep the disclosure affordance in the row icon slot. This mirrors the
 * sidebar pattern used by Notion: the item identity is visible at rest, and
 * the same-sized expand/collapse affordance appears in its place when
 * targeted.
 */
export function FileTreeDisclosureIcon({
	isExpanded,
	icon,
}: {
	isExpanded: boolean;
	icon: ReactNode;
}) {
	return (
		<span className="relative flex size-4 shrink-0 items-center justify-center">
			<span className="transition-opacity duration-100 group-hover:opacity-0 group-focus-visible:opacity-0">
				{icon}
			</span>
			<ChevronRightIcon
				className={cn(
					"pointer-events-none absolute size-4 text-muted-foreground opacity-0 transition-[opacity,transform] duration-100 group-hover:opacity-100 group-focus-visible:opacity-100",
					isExpanded && "rotate-90",
				)}
				aria-hidden
			/>
		</span>
	);
}

/** Ring shown on the row a drag is currently hovering (valid drop target). */
const DROP_RING = "ring-1 ring-inset ring-primary bg-accent";
const SELECTED_ROW = [
	"bg-sidebar-primary/75 text-sidebar-primary-foreground",
	"hover:bg-sidebar-primary/85 active:bg-sidebar-primary/90",
	"[&_svg]:text-sidebar-primary-foreground/90",
].join(" ");

/**
 * Flat folder ROW (no nested children) for virtualized rendering: renders the
 * folder button only; its children are separate flattened rows. Reads the same
 * FileTreeContext as {@link FileTreeFile}.
 */
export const FileTreeFolderRow = ({
	path,
	name,
	icon,
	className,
}: {
	path: string;
	name: string;
	/** Overrides the default folder glyph (e.g. the Library icon for `papers/`). */
	icon?: ReactNode;
	className?: string;
}) => {
	const {
		expandedPaths,
		togglePath,
		selectedPath,
		selectedPaths,
		onSelectRow,
		onDoubleClickPath,
		onContextMenuPath,
		dropTargetPath,
		onRowDragStart,
		onRowDragOver,
		onRowDrop,
		onRowDragEnd,
	} = useContext(FileTreeContext);
	const isExpanded = expandedPaths.has(path);
	const selCount = selectedPaths?.size ?? 0;
	const isSelected =
		selCount > 0 ? (selectedPaths?.has(path) ?? false) : selectedPath === path;
	return (
		<button
			type="button"
			data-path={path}
			draggable
			className={cn(
				"group flex h-7 min-h-7 w-full items-center gap-1 rounded px-4 text-left transition-colors duration-75 hover:bg-sidebar-accent/80 active:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/80",
				isSelected && SELECTED_ROW,
				dropTargetPath === path && DROP_RING,
				className,
			)}
			onClick={(e) => {
				if ((e.metaKey || e.ctrlKey || e.shiftKey) && onSelectRow) {
					onSelectRow(path, {
						meta: e.metaKey,
						ctrl: e.ctrlKey,
						shift: e.shiftKey,
					});
					return;
				}
				// Expand/collapse children in the tree AND notify selection so the
				// host can open a folder-scoped paper list in the center pane.
				togglePath(path);
				onSelectRow?.(path, {
					meta: false,
					ctrl: false,
					shift: false,
				});
			}}
			onDoubleClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onDoubleClickPath?.(path);
			}}
			onContextMenu={(e) => onContextMenuPath?.(path, e)}
			onDragStart={(e) => onRowDragStart?.(path, e)}
			onDragOver={(e) => onRowDragOver?.(path, e)}
			onDrop={(e) => onRowDrop?.(path, e)}
			onDragEnd={() => onRowDragEnd?.()}
			aria-expanded={isExpanded}
			aria-selected={isSelected}
			role="treeitem"
		>
			<FileTreeDisclosureIcon
				isExpanded={isExpanded}
				icon={
					icon ??
					(isExpanded ? (
						<FolderOpenIcon className="size-4 text-blue-500" aria-hidden />
					) : (
						<FolderIcon className="size-4 text-blue-500" aria-hidden />
					))
				}
			/>
			<FileTreeName>{name}</FileTreeName>
		</button>
	);
};

interface FileTreeFileContextType {
	path: string;
	name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
	name: "",
	path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
	path: string;
	name: string;
	icon?: ReactNode;
};

export const FileTreeFile = ({
	path,
	name,
	icon,
	className,
	children,
	...props
}: FileTreeFileProps) => {
	const {
		selectedPath,
		onSelect,
		onDoubleClickPath,
		onContextMenuPath,
		selectedPaths,
		onSelectRow,
		dropTargetPath,
		onRowDragStart,
		onRowDragOver,
		onRowDrop,
		onRowDragEnd,
	} = useContext(FileTreeContext);
	const selCount = selectedPaths?.size ?? 0;
	const isSelected =
		selCount > 0 ? (selectedPaths?.has(path) ?? false) : selectedPath === path;

	const handleClick = useCallback(
		(e: MouseEvent) => {
			if (onSelectRow) {
				onSelectRow(path, {
					meta: e.metaKey,
					ctrl: e.ctrlKey,
					shift: e.shiftKey,
				});
			} else {
				onSelect?.(path);
			}
		},
		[onSelect, onSelectRow, path],
	);

	const handleDoubleClick = useCallback(
		(e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			onDoubleClickPath?.(path);
		},
		[onDoubleClickPath, path],
	);

	const handleContextMenu = useCallback(
		(e: MouseEvent) => {
			onContextMenuPath?.(path, e);
		},
		[onContextMenuPath, path],
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLDivElement>) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				if (onSelectRow) {
					onSelectRow(path, {
						meta: e.metaKey,
						ctrl: e.ctrlKey,
						shift: e.shiftKey,
					});
				} else {
					onSelect?.(path);
				}
			}
		},
		[onSelect, onSelectRow, path],
	);

	const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

	return (
		<FileTreeFileContext.Provider value={fileContextValue}>
			<div
				data-path={path}
				draggable
				className={cn(
					"group flex h-7 min-h-7 cursor-pointer items-center gap-1 rounded px-4 transition-colors duration-75 hover:bg-sidebar-accent/80 active:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/80",
					isSelected && SELECTED_ROW,
					dropTargetPath === path && DROP_RING,
					className,
				)}
				onClick={handleClick}
				onDoubleClick={handleDoubleClick}
				onContextMenu={handleContextMenu}
				onKeyDown={handleKeyDown}
				onDragStart={(e) => onRowDragStart?.(path, e)}
				onDragOver={(e) => onRowDragOver?.(path, e)}
				onDrop={(e) => onRowDrop?.(path, e)}
				onDragEnd={() => onRowDragEnd?.()}
				role="treeitem"
				aria-selected={isSelected}
				tabIndex={0}
				{...props}
			>
				{children ?? (
					<>
						<FileTreeIcon>
							{icon ?? <FileIcon className="size-4 text-muted-foreground" />}
						</FileTreeIcon>
						<FileTreeName>{name}</FileTreeName>
					</>
				)}
			</div>
		</FileTreeFileContext.Provider>
	);
};

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

export const FileTreeActions = ({
	className,
	children,
	...props
}: FileTreeActionsProps) => (
	<div className={cn("ml-auto flex items-center gap-1", className)} {...props}>
		{children}
	</div>
);
