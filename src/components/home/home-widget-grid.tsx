import { GripHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useDrag, useDragLayer, useDrop } from "react-dnd";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { HomeSettings, HomeWidgetId } from "@/lib/cloud/home-settings";
import { cn } from "@/lib/core/utils";

const WIDGET_DRAG = "lattiora-home-widget";
type WidgetDrag = { id: HomeWidgetId; localId: string | null };
type MoveWidget = (
	from: HomeWidgetId,
	to: HomeWidgetId,
	localId: string | null,
) => Promise<void>;

export function HomeWidgetGrid({
	widgets,
	localId,
	disabled,
	onMove,
	children,
}: {
	widgets: HomeSettings["widgets"];
	localId: string | null;
	disabled: boolean;
	onMove: MoveWidget;
	children: (id: HomeWidgetId) => ReactNode;
}) {
	return (
		<div
			className="grid grid-cols-1 items-stretch gap-4 @min-[32rem]/home-grid:grid-cols-2 @min-[56rem]/home-grid:grid-cols-4"
			data-home-widgets
			aria-busy={disabled}
		>
			{widgets.map((widget, index) => (
				<HomeWidget
					key={widget.id}
					widget={widget}
					localId={localId}
					disabled={disabled}
					onMove={onMove}
					ids={widgets.map((item) => item.id)}
					index={index}
				>
					{children(widget.id)}
				</HomeWidget>
			))}
			<HomeWidgetDragPreview />
		</div>
	);
}

function HomeWidget({
	widget,
	localId,
	disabled,
	onMove,
	ids,
	index,
	children,
}: {
	widget: HomeSettings["widgets"][number];
	localId: string | null;
	disabled: boolean;
	onMove: MoveWidget;
	ids: HomeWidgetId[];
	index: number;
	children: ReactNode;
}) {
	const { t } = useTranslation("app");
	const handle = useRef<HTMLButtonElement | null>(null);
	const [{ dragging }, drag] = useDrag(
		() => ({
			type: WIDGET_DRAG,
			item: (): WidgetDrag => ({ id: widget.id, localId }),
			canDrag: !disabled,
			collect: (monitor) => ({ dragging: monitor.isDragging() }),
		}),
		[widget.id, localId, disabled],
	);
	const [{ over }, drop] = useDrop<WidgetDrag, void, { over: boolean }>(
		() => ({
			accept: WIDGET_DRAG,
			canDrop: (item) => !disabled && item.id !== widget.id,
			drop: (item) => {
				void onMove(item.id, widget.id, item.localId);
			},
			collect: (monitor) => ({
				over: monitor.isOver({ shallow: true }) && monitor.canDrop(),
			}),
		}),
		[widget.id, disabled, onMove],
	);
	return (
		<div
			ref={(node) => {
				drop(node);
			}}
			data-home-widget={widget.id}
			className={cn(
				"@container/home-widget group/home-widget relative min-w-0 rounded-xl [overflow-wrap:anywhere]",
				widget.width === 4
					? "@min-[32rem]/home-grid:col-span-2 @min-[56rem]/home-grid:col-span-4"
					: widget.width === 2 && "@min-[32rem]/home-grid:col-span-2",
				dragging && "opacity-40",
				over && "ring-2 ring-primary ring-offset-2 ring-offset-background",
			)}
		>
			<button
				ref={(node) => {
					handle.current = node;
					drag(node);
				}}
				type="button"
				disabled={disabled}
				aria-label={t("home.dragWidget", {
					name: t(`home.widgets.${widget.id}`),
				})}
				title={t("home.dragWidget", { name: t(`home.widgets.${widget.id}`) })}
				aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End"
				className="absolute top-0 left-1/2 z-10 flex h-8 w-10 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-md border bg-card text-muted-foreground opacity-0 shadow-sm hover:text-foreground group-hover/home-widget:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-wait pointer-coarse:size-11 pointer-coarse:opacity-100 cursor-grab active:cursor-grabbing"
				onKeyDown={(event) => {
					const target =
						event.key === "Home"
							? 0
							: event.key === "End"
								? ids.length - 1
								: event.key === "ArrowUp" || event.key === "ArrowLeft"
									? index - 1
									: event.key === "ArrowDown" || event.key === "ArrowRight"
										? index + 1
										: null;
					if (target === null) return;
					event.preventDefault();
					if (ids[target] && target !== index)
						void onMove(widget.id, ids[target], localId).then(() => {
							// Wait for the saving state to re-enable the button after moving it.
							requestAnimationFrame(() => handle.current?.focus());
						});
				}}
			>
				<GripHorizontal className="size-4" />
			</button>
			{children}
		</div>
	);
}

function HomeWidgetDragPreview() {
	const { t } = useTranslation("app");
	const { item, offset } = useDragLayer((monitor) => ({
		item:
			monitor.isDragging() && monitor.getItemType() === WIDGET_DRAG
				? monitor.getItem<WidgetDrag>()
				: null,
		offset: monitor.getClientOffset(),
	}));
	const pointer = useRef(offset);
	pointer.current = offset;
	useEffect(() => {
		if (!item) return;
		const scroller = document.querySelector<HTMLElement>("[data-home-scroll]");
		if (!scroller) return;
		let frame = 0;
		let previous = performance.now();
		const scroll = (now: number) => {
			const point = pointer.current;
			const bounds = scroller.getBoundingClientRect();
			const elapsed = Math.min(now - previous, 40);
			previous = now;
			if (point && point.x >= bounds.left && point.x <= bounds.right) {
				const edge = 48;
				const distance =
					point.y < bounds.top + edge
						? point.y - bounds.top - edge
						: point.y > bounds.bottom - edge
							? point.y - bounds.bottom + edge
							: 0;
				scroller.scrollTop +=
					Math.max(-1, Math.min(1, distance / edge)) * elapsed * 0.6;
			}
			frame = requestAnimationFrame(scroll);
		};
		frame = requestAnimationFrame(scroll);
		return () => cancelAnimationFrame(frame);
	}, [item]);
	if (!item || !offset) return null;
	return createPortal(
		<div
			aria-hidden="true"
			className="pointer-events-none fixed top-0 left-0 z-[9999] flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg"
			style={{ transform: `translate(${offset.x + 12}px, ${offset.y + 12}px)` }}
		>
			<GripHorizontal className="size-4" />
			{t(`home.widgets.${item.id}`)}
		</div>,
		document.body,
	);
}
