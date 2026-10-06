"use client";

import {
	DndPlugin,
	type DragItemNode,
	type ElementDragItemNode,
	getDropPath,
	onDropNode,
	onHoverNode,
	useDraggable,
	useDropLine,
} from "@platejs/dnd";
import { expandListItemsWithChildren } from "@platejs/list";
import {
	BlockSelectionPlugin,
	useBlockSelected,
} from "@platejs/selection/react";
import { getPluginByType, NodeApi, type TElement } from "platejs";
import {
	MemoizedChildren,
	type PlateEditor,
	type PlateElementProps,
	type RenderNodeWrapper,
	useEditorRef,
	usePluginOption,
	usePluginOptions,
} from "platejs/react";
import * as React from "react";
import type { DropTargetMonitor } from "react-dnd";

import { setBlockDragAnchor } from "@/components/editor/nodes/block/block-drag-preview";
import { BlockHandleMenu } from "@/components/editor/nodes/block/block-handle-menu";
import { cn } from "@/lib/core/utils";
import { isBlankParagraph } from "@/lib/markdown/block-selection";
import {
	addColumnToGroup,
	COLUMN_GROUP_KEY,
	convertImageGroupToColumnGroup,
	createColumnGroupFromBlocks,
	MAX_COLUMNS,
} from "@/lib/markdown/columns";
import { IMAGE_GROUP_KEY, isImageishType } from "@/lib/markdown/image-group";

/**
 * Mirrors the two global drag/marquee flags onto the editable root as data
 * attributes so per-block styling can read them through CSS.
 *
 * Every block used to subscribe to these itself, which meant drag start/end and
 * marquee start/end re-rendered all N block wrappers. One subscriber plus a
 * descendant selector costs nothing per block.
 *
 * `useLayoutEffect`, not `useEffect`: `isSelectionAreaVisible` flips once the
 * marquee passes its 4px start threshold, and a frame-late attribute would flash
 * a drag handle under the pointer right as the marquee begins.
 */
export function BlockDragStateBridge() {
	const editor = useEditorRef();
	const isDragging = usePluginOption(DndPlugin, "isDragging");
	const isSelectionAreaVisible = usePluginOption(
		BlockSelectionPlugin,
		"isSelectionAreaVisible",
	);

	React.useLayoutEffect(() => {
		const root = editor.api.toDOMNode(editor);
		if (!root) return;
		root.toggleAttribute("data-dnd-dragging", Boolean(isDragging));
		root.toggleAttribute(
			"data-dnd-selection-area",
			Boolean(isSelectionAreaVisible),
		);
	}, [editor, isDragging, isSelectionAreaVisible]);

	return null;
}

function isInsideColumnGroup(editor: PlateEditor, path: number[]): boolean {
	if (path.length !== 2) return false;
	const parent = NodeApi.get(editor, [path[0]]) as TElement | undefined;
	return parent?.type === COLUMN_GROUP_KEY;
}

export const BlockDraggable: RenderNodeWrapper = (props) => {
	const { editor, path } = props;
	if (editor.dom.readOnly) return;
	if (path.length !== 1 && !isInsideColumnGroup(editor, path)) return;
	return (childProps: PlateElementProps) => <Draggable {...childProps} />;
};

export function isElementDragItemNode(
	dragItem: DragItemNode,
): dragItem is ElementDragItemNode {
	return "id" in dragItem && dragItem.id != null;
}

/**
 * 单块图片/组的拖拽在图片类目标上横向落位(左右半分),与目标并排成组;
 * 多块拖拽与非图片块保持纵向(上下半分)的常规行为。
 */
function imageGroupDropOrientation(
	editor: PlateEditor,
	dragItem: ElementDragItemNode,
): "horizontal" | "vertical" {
	if (Array.isArray(dragItem.id) && dragItem.id.length > 1) return "vertical";
	if (!dragItem.element || !isImageishType(editor, dragItem.element.type))
		return "vertical";
	return "horizontal";
}

function Draggable(props: PlateElementProps) {
	const { children, editor, element, path } = props;
	const blockSelectionApi = editor.getApi(BlockSelectionPlugin).blockSelection;

	// 图片/组目标需要横向 hover/drop,而 useDraggable 内部自建 nodeRef 在
	// 覆盖回调里拿不到 —— 自建一个,既传入 hook 也挂到节点上。
	const dropNodeRef = React.useRef<HTMLDivElement | null>(null);
	const isImageishTarget = isImageishType(editor, element.type);
	const isTopLevel = Array.isArray(path) && path.length === 1;
	const [columnDrop, setColumnDrop] = React.useState(false);

	const { isDragging, handleRef } = useDraggable({
		element,
		nodeRef: dropNodeRef,
		onDropHandler: (_, { dragItem }) => {
			const id = (dragItem as { id: string[] | string }).id;
			blockSelectionApi.add(id);
			return false;
		},
		// 顶层块额外处理右侧分栏落位;图片类目标保持横向落线/落位。
		...(isTopLevel && {
			drop: {
				hover: (dragItem: DragItemNode, monitor: DropTargetMonitor) => {
					// 指针悬在组内图片 item 上时,更深的 item drop 目标同样会收到
					// hover —— 让出落线,避免外层覆盖 item 的精确位置。
					if (!monitor.isOver({ shallow: true })) {
						setColumnDrop(false);
						return;
					}
					if (
						isColumnDropZone(
							editor,
							dragItem,
							element,
							monitor,
							dropNodeRef,
							path,
						)
					) {
						setColumnDrop(true);
						return;
					}
					setColumnDrop(false);
					onHoverNode(editor, {
						dragItem,
						element,
						monitor,
						nodeRef: dropNodeRef,
						orientation: isElementDragItemNode(dragItem)
							? imageGroupDropOrientation(editor, dragItem)
							: "vertical",
					});
				},
				drop: (dragItem: DragItemNode, monitor: DropTargetMonitor) => {
					setColumnDrop(false);
					if (columnDrop && isElementDragItemNode(dragItem)) {
						handleColumnDrop(
							editor,
							dragItem,
							element,
							path,
							blockSelectionApi,
						);
						return;
					}
					// 文件拖放保持 stock 语义(纵向落位插入),图片文件仍可拖入。
					if (!isElementDragItemNode(dragItem)) {
						const result = getDropPath(editor, {
							dragItem,
							element,
							monitor,
							nodeRef: dropNodeRef,
							orientation: "vertical",
						});
						const onDropFiles = editor.getOptions(DndPlugin).onDropFiles;
						if (!result || !onDropFiles) return;
						onDropFiles({
							id: element.id as string,
							dragItem,
							editor,
							monitor,
							nodeRef: dropNodeRef,
							target: result.to,
						});
						return;
					}
					// 复刻 onDropHandler(drop 后恢复块选),再走横向落位;
					// 左≡上、右≡下,moveNodes 落到目标旁,成组交给 normalize。
					blockSelectionApi.add(dragItem.id);
					onDropNode(editor, {
						dragItem,
						element,
						monitor,
						nodeRef: dropNodeRef,
						orientation: imageGroupDropOrientation(editor, dragItem),
					});
				},
			},
		}),
	});

	const [dragButtonTop, setDragButtonTop] = React.useState(0);
	const [menuOpen, setMenuOpen] = React.useState(false);
	const isBlockSelected = useBlockSelected();
	const isBlank = isBlankParagraph(element);
	const isContainer = Boolean(
		getPluginByType(editor, element.type)?.node.isContainer,
	);
	// useDraggable().isDragging is only true on the handle's node. Dim every id in
	// draggingId so a multi-block drag fades the whole set. The selector must
	// return a boolean: usePluginOptions bails out on Object.is, so non-dragged
	// blocks do not re-render when the option changes.
	const isNodeDragging = usePluginOptions(
		DndPlugin,
		(state) =>
			Boolean(state.isDragging) &&
			isIdInDraggingSet(element.id, state.draggingId),
	);
	// Headings reset their top margin at the document start (heading-node.tsx),
	// so the handle offset differs there for the same element type.
	const isDocumentStart =
		Array.isArray(props.path) && props.path.length === 1 && props.path[0] === 0;

	const prepareDrag = React.useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			window.getSelection()?.removeAllRanges();

			const blockSelection = editor
				.getApi(BlockSelectionPlugin)
				.blockSelection.getNodes({ sort: true });
			let selectionNodes =
				blockSelection.length > 0
					? blockSelection
					: editor.api.blocks({ mode: "highest" });
			if (!selectionNodes.some(([node]) => node.id === element.id)) {
				const path = editor.api.findPath(element);
				if (!path) return;
				selectionNodes = [[element, path]];
			}
			const blocks = expandListItemsWithChildren(editor, selectionNodes).map(
				([node]) => node,
			);
			const ids = blocks
				.map((block) => block.id)
				.filter((id): id is string => typeof id === "string");
			// Same contract as Plate playground BlockDraggable: draggingId is the
			// full id list; item() then drags every id, not just the handle's node.
			editor.setOption(DndPlugin, "draggingId", ids);
			editor.getApi(BlockSelectionPlugin).blockSelection.set(ids);

			const first = blocks[0] ?? element;
			const firstRect = editor.api.toDOMNode(first)?.getBoundingClientRect();
			const widths = blocks.map(
				(block) =>
					editor.api.toDOMNode(block)?.getBoundingClientRect().width ?? 0,
			);
			if (firstRect) {
				setBlockDragAnchor({
					offsetX: event.clientX - firstRect.left,
					offsetY: event.clientY - firstRect.top,
					width: Math.max(firstRect.width, ...widths),
				});
			}

			// Official kit only blurs for a caret-originated single-block drag.
			if (blockSelection.length === 0) {
				editor.tf.blur();
				editor.tf.collapse();
			}
		},
		[editor, element],
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: hover only positions the handle
		<div
			className={cn(
				"relative",
				isNodeDragging && "select-none opacity-50",
				isContainer ? "group/container" : "group",
				!isBlank && (menuOpen || isBlockSelected) && "rounded-md bg-muted/40",
			)}
			onMouseEnter={() => {
				if (isDragging) return;
				setDragButtonTop(calcDragButtonTop(editor, element, isDocumentStart));
			}}
		>
			{isBlank ? null : (
				<Gutter
					isContainer={isContainer}
					forceVisible={menuOpen || isBlockSelected}
				>
					<div className="slate-blockToolbarWrapper flex h-[1.5em]">
						<div className="slate-blockToolbar pointer-events-auto relative mr-1 flex w-[1.125rem] items-center">
							<BlockHandleMenu
								element={element}
								handleRef={handleRef}
								isDragging={Boolean(isDragging)}
								onMenuOpenChange={setMenuOpen}
								onPrepareDrag={prepareDrag}
								style={{ top: `${dragButtonTop + 3}px` }}
							/>
						</div>
					</div>
				</Gutter>
			)}

			{/* biome-ignore lint/a11y/noStaticElementInteractions: right-click selects the block */}
			<div
				ref={dropNodeRef}
				className="slate-blockWrapper flow-root"
				onContextMenu={(event) =>
					editor
						.getApi(BlockSelectionPlugin)
						.blockSelection.addOnContextMenu({ element, event })
				}
			>
				<MemoizedChildren>{children}</MemoizedChildren>
				<DropLine orientation={isImageishTarget ? "horizontal" : "vertical"} />
				<ColumnDropLine show={columnDrop} />
			</div>
		</div>
	);
}

function Gutter({
	children,
	forceVisible,
	isContainer,
}: {
	children: React.ReactNode;
	forceVisible: boolean;
	isContainer: boolean;
}) {
	return (
		<div
			className={cn(
				"slate-gutterLeft",
				"-translate-x-full absolute top-0 z-50 flex h-full cursor-grab opacity-0",
				isContainer
					? "group-hover/container:opacity-100"
					: "group-hover:opacity-100",
				forceVisible && "opacity-100",
				// Marquee in progress: hide the handle so it never appears under the
				// pointer. Attribute comes from BlockDragStateBridge.
				!forceVisible && "[[data-dnd-selection-area]_&]:hidden",
			)}
			contentEditable={false}
		>
			{children}
		</div>
	);
}

const DropLine = React.memo(function DropLine({
	orientation,
}: {
	orientation: "horizontal" | "vertical";
}) {
	const { dropLine } = useDropLine({ orientation });
	if (!dropLine) return null;

	return (
		<div
			className={cn(
				"slate-dropLine pointer-events-none absolute z-10 bg-foreground/40",
				dropLine === "top" && "-top-px inset-x-0 h-0.5",
				dropLine === "bottom" && "-bottom-px inset-x-0 h-0.5",
				dropLine === "left" && "-left-px inset-y-0 w-0.5",
				dropLine === "right" && "-right-px inset-y-0 w-0.5",
			)}
		/>
	);
});

const COLUMN_DROP_THRESHOLD = 0.8;

const ColumnDropLine = React.memo(function ColumnDropLine({
	show,
}: {
	show: boolean;
}) {
	if (!show) return null;
	return (
		<div className="pointer-events-none absolute inset-y-0 -right-1 z-10 w-0.5 bg-foreground/60" />
	);
});

function isColumnDropZone(
	_editor: PlateEditor,
	dragItem: DragItemNode,
	targetElement: TElement,
	monitor: DropTargetMonitor,
	nodeRef: React.RefObject<HTMLDivElement | null>,
	targetPath: number[],
): boolean {
	if (!isElementDragItemNode(dragItem)) return false;
	if (Array.isArray(dragItem.id) && dragItem.id.length > 1) return false;
	if (targetPath.length !== 1) return false;
	const sourceId = Array.isArray(dragItem.id) ? dragItem.id[0] : dragItem.id;
	if (sourceId === targetElement.id) return false;
	if (
		targetElement.type === COLUMN_GROUP_KEY &&
		(targetElement.children as TElement[]).length >= MAX_COLUMNS
	) {
		return false;
	}
	const clientOffset = monitor.getClientOffset();
	const rect = nodeRef.current?.getBoundingClientRect();
	if (!clientOffset || !rect || rect.width <= 0) return false;
	const relativeX = clientOffset.x - rect.left;
	return relativeX >= rect.width * COLUMN_DROP_THRESHOLD;
}

function handleColumnDrop(
	editor: PlateEditor,
	dragItem: ElementDragItemNode,
	targetElement: TElement,
	targetPath: number[],
	blockSelectionApi: { add: (id: string | string[]) => void },
): void {
	const sourceId = Array.isArray(dragItem.id) ? dragItem.id[0] : dragItem.id;
	const sourceEntry = editor.api.node({ id: sourceId, at: [] });
	if (!sourceEntry) return;
	const [, sourcePath] = sourceEntry;
	if (!sourcePath) return;

	if (targetElement.type === COLUMN_GROUP_KEY) {
		addColumnToGroup(editor, targetPath, sourcePath);
	} else if (targetElement.type === IMAGE_GROUP_KEY) {
		convertImageGroupToColumnGroup(editor, targetPath, sourcePath);
	} else {
		createColumnGroupFromBlocks(editor, targetPath, sourcePath);
	}
	blockSelectionApi.add(dragItem.id);
}

function isIdInDraggingSet(
	id: unknown,
	draggingId: string | string[] | null | undefined,
): boolean {
	if (typeof id !== "string" || draggingId == null) return false;
	return Array.isArray(draggingId)
		? draggingId.includes(id)
		: draggingId === id;
}

/**
 * Block top margins are fixed rem keyed by element type, plus the document-start
 * heading reset — so one measurement serves every block of the same shape.
 *
 * This matters because the caller is the block's `mouseenter`, which also fires
 * for every block that scrolls past a resting pointer (and when typing reflows
 * the document under one). Measuring there forced a style recalc per block.
 */
const dragButtonTopCache = new Map<string, number>();

const calcDragButtonTop = (
	editor: PlateEditor,
	element: TElement,
	isDocumentStart: boolean,
): number => {
	// uiScale is applied as an inline root font-size, so reading it back is a
	// CSSOM lookup rather than a layout read.
	const key = `${document.documentElement.style.fontSize}|${element.type}|${isDocumentStart}`;
	const cached = dragButtonTopCache.get(key);
	if (cached !== undefined) return cached;
	const child = editor.api.toDOMNode(element);
	if (!child) return 0;
	const marginTop = Number.parseFloat(window.getComputedStyle(child).marginTop);
	const top = Number.isFinite(marginTop) ? marginTop : 0;
	dragButtonTopCache.set(key, top);
	return top;
};
