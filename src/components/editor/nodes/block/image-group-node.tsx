"use client";

import type { DragItemNode, ElementDragItemNode } from "@platejs/dnd";
import {
	DRAG_ITEM_BLOCK,
	onDropNode,
	onHoverNode,
	useDndNode,
	useDropLine,
} from "@platejs/dnd";
import { GripVertical } from "lucide-react";
import type { TElement } from "platejs";
import {
	type PlateEditor,
	PlateElement,
	type PlateElementProps,
	useEditorRef,
} from "platejs/react";
import * as React from "react";
import { type DropTargetMonitor, useDrop } from "react-dnd";
import { ImageGroupContext } from "@/components/editor/context/image-group-context";
import { isElementDragItemNode } from "@/components/editor/nodes/block/block-draggable";
import { cn } from "@/lib/core/utils";
import { isImageBlock } from "@/lib/markdown/image-group";

type TImageGroupChild = TElement & { id?: string; url?: string };

/**
 * 飞书式图片组:子图片单行并排、自动等高。宽度按各图宽高比分配
 * (`flex: r 1 0%` + `aspect-ratio: r` 使高度收敛到同一行高),放不下时
 * flex-wrap 降级换行。宽高比是展示期状态,不写入文档。
 */
export function ImageGroupElement(props: PlateElementProps<TElement>) {
	const items = props.element.children as TImageGroupChild[];
	const groupPath = props.path ?? [];
	const [ratios, setRatios] = React.useState<Record<string, number>>({});
	const reportRatio = React.useCallback((url: string, ratio: number) => {
		setRatios((prev) =>
			prev[url] === ratio ? prev : { ...prev, [url]: ratio },
		);
	}, []);

	return (
		<ImageGroupContext.Provider value={{ reportRatio }}>
			<PlateElement {...props} className="flex flex-wrap gap-2 py-2">
				{React.Children.map(props.children, (child, index) => {
					const element = items[index];
					const ratio = element?.url ? ratios[element.url] : undefined;
					return (
						<React.Fragment key={element?.id ?? index}>
							<ImageGroupGapDropZone
								groupPath={groupPath}
								insertIndex={index}
							/>
							<ImageGroupItem element={element} ratio={ratio}>
								{child}
							</ImageGroupItem>
						</React.Fragment>
					);
				})}
			</PlateElement>
		</ImageGroupContext.Provider>
	);
}

/** 单图拖拽(可精确落到某张图旁);整组/多块/段落走组外壳或顶层目标。 */
function isSingleImageDrag(
	editor: PlateEditor,
	dragItem: DragItemNode,
): dragItem is ElementDragItemNode {
	if (!isElementDragItemNode(dragItem)) return false;
	if (Array.isArray(dragItem.id) && dragItem.id.length > 1) return false;
	return isImageBlock(editor, dragItem.element);
}

function ImageGroupItem({
	element,
	ratio,
	children,
}: {
	element: TImageGroupChild;
	ratio?: number;
	children: React.ReactNode;
}) {
	const editor = useEditorRef();
	// 只读面(export/embed)没有 DndPlugin;live 只读下同样不接拖拽。
	// 结构收敛/卸载过程中 element 可能短暂缺失,避免把 undefined 传给 DnD hook。
	if (
		editor.dom.readOnly ||
		!editor.plugins.dnd ||
		!element?.id ||
		!isImageBlock(editor, element)
	) {
		return (
			<ImageGroupItemLayout ratio={ratio}>{children}</ImageGroupItemLayout>
		);
	}
	return (
		<ImageGroupItemDnd element={element} ratio={ratio}>
			{children}
		</ImageGroupItemDnd>
	);
}

function ImageGroupItemDnd({
	element,
	ratio,
	children,
}: {
	element: TImageGroupChild;
	ratio?: number;
	children: React.ReactNode;
}) {
	const editor = useEditorRef();
	const dropNodeRef = React.useRef<HTMLDivElement | null>(null);

	const { dragRef, isDragging } = useDndNode({
		// drag item 的 element 由 id 全树查回(useDragNode),组内 img 同样命中。
		// 拖影统一走 BlockDragPreview 自定义层,禁用 preview 防双影。
		element,
		nodeRef: dropNodeRef,
		orientation: "horizontal",
		preview: { disable: true },
		drop: {
			hover: (dragItem: DragItemNode, monitor: DropTargetMonitor) => {
				if (!isSingleImageDrag(editor, dragItem)) return;
				onHoverNode(editor, {
					dragItem,
					element,
					monitor,
					nodeRef: dropNodeRef,
					orientation: "horizontal",
				});
			},
			drop: (dragItem: DragItemNode, monitor: DropTargetMonitor) => {
				if (!isSingleImageDrag(editor, dragItem)) return;
				// 左/右半分落位:moveNodes 移到目标图旁(同组换位、跨组移动、
				// 顶层图进组中部),缩容/扩容/解散交给 normalize 收敛。
				onDropNode(editor, {
					dragItem,
					element,
					monitor,
					nodeRef: dropNodeRef,
					orientation: "horizontal",
				});
				return {}; // 已处理,阻断冒泡到组外壳的二次 moveNodes
			},
		},
	});

	const setDragHandle = React.useCallback(
		(node: HTMLDivElement | null) => {
			dragRef(node);
		},
		[dragRef],
	);

	const { dropLine } = useDropLine({
		id: element.id,
		orientation: "horizontal",
	});

	return (
		<ImageGroupItemLayout
			ratio={ratio}
			isDragging={isDragging}
			dragHandleRef={setDragHandle}
			itemRef={(node) => {
				// useDndNode 内部已把 dropNodeRef 连接为 drop 目标。
				dropNodeRef.current = node;
			}}
		>
			{children}
			{dropLine ? (
				<div
					className={cn(
						"pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-foreground/40",
						dropLine === "left" ? "-left-1" : "-right-1",
					)}
				/>
			) : null}
		</ImageGroupItemLayout>
	);
}

/**
 * 图片组项之间的落位区：把单张图片拖到两个图的缝隙里，插入到对应位置。
 * 宽度为 0 的 flex 占位，内部绝对定位把可感应区域扩大到实际 gap 上。
 */
function ImageGroupGapDropZone({
	groupPath,
	insertIndex,
}: {
	groupPath: number[];
	insertIndex: number;
}) {
	const editor = useEditorRef();
	const [{ isOver }, dropRef] = useDrop({
		accept: DRAG_ITEM_BLOCK,
		hover: (dragItem: DragItemNode, monitor: DropTargetMonitor) => {
			if (!isSingleImageDrag(editor, dragItem)) return;
			// 阻止事件继续冒泡到组外壳，避免同时触发整组的落线。
			monitor.isOver({ shallow: true });
		},
		drop: (dragItem: DragItemNode, monitor: DropTargetMonitor) => {
			if (!monitor.isOver({ shallow: true })) return;
			if (!isElementDragItemNode(dragItem)) return;
			if (!isSingleImageDrag(editor, dragItem)) return;

			const sourceId = Array.isArray(dragItem.id)
				? dragItem.id[0]
				: dragItem.id;
			const sourceEntry = editor.api.node({ id: sourceId, at: [] });
			if (!sourceEntry) return;
			const [, sourcePath] = sourceEntry;
			if (!sourcePath) return;

			const [groupIndex] = groupPath;
			editor.tf.moveNodes({
				at: sourcePath,
				to: [groupIndex, insertIndex],
			});
		},
		collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) }),
	});

	return (
		<div
			ref={(node) => {
				dropRef(node);
			}}
			className="relative w-0 self-stretch"
		>
			<div
				className={cn(
					"pointer-events-auto absolute left-1/2 top-0 bottom-0 z-20 w-3 -translate-x-1/2",
					isOver && "bg-foreground/30",
				)}
			/>
		</div>
	);
}

function ImageGroupItemLayout({
	ratio,
	isDragging,
	dragHandleRef,
	itemRef,
	children,
}: {
	ratio?: number;
	isDragging?: boolean;
	dragHandleRef?: (node: HTMLDivElement | null) => void;
	itemRef?: (node: HTMLDivElement | null) => void;
	children: React.ReactNode;
}) {
	// grow=比例 → 宽度按宽高比分配;aspect-ratio=比例 → 各项高度一致。
	// 加载前没有比例:均分占位,给个最小高度保持组的形状。
	const style: React.CSSProperties =
		ratio != null && Number.isFinite(ratio) && ratio > 0
			? { aspectRatio: `${ratio}`, flex: `${ratio} 1 0%` }
			: { flex: "1 1 0%", minHeight: "4rem" };
	return (
		<div
			className="group/item relative m-0 min-w-[72px]"
			style={style}
			ref={itemRef}
		>
			{dragHandleRef ? (
				<div
					ref={dragHandleRef}
					className={cn(
						"absolute -left-4 top-0 z-20 flex h-5 w-4 cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity",
						"hover:bg-muted hover:text-foreground group-hover/item:opacity-100",
						isDragging && "cursor-grabbing opacity-100",
					)}
				>
					<GripVertical className="size-3" aria-hidden />
				</div>
			) : null}
			{children}
		</div>
	);
}
