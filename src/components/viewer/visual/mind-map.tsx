import {
	ChevronDown,
	ChevronRight,
	ChevronsUpDown,
	Focus,
	GitBranchPlus,
	GripVertical,
	Maximize,
	Network,
	Plus,
	RotateCcw,
	Trash2,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	branchIds,
	layoutMindMap,
	type MindMap,
	type MindMapNode,
} from "@/lib/workspace/visual-documents";
import { fieldClass, IconButton } from "./controls";
import { SketchPath } from "./sketch-path";

const branchColors = ["#8465b4", "#397ca9", "#4d8b68", "#b88735", "#b65d82"];

export function MindMapEditor({
	doc,
	onChange,
}: {
	doc: MindMap;
	onChange: (doc: MindMap) => void;
}) {
	const { t } = useTranslation("viewer");
	const root = doc.nodes.find((node) => node.parentId === null) ?? doc.nodes[0];
	const [selectedId, select] = useState(root.id);
	const [zoom, setZoom] = useState(1);
	const [camera, setCamera] = useState({ x: 0, y: 0 });
	const [dragOffset, setDragOffset] = useState<{
		id: string;
		x: number;
		y: number;
	} | null>(null);
	const drag = useRef<{
		id: string;
		pointer: number;
		x: number;
		y: number;
		dx: number;
		dy: number;
	} | null>(null);
	const viewport = useRef<HTMLDivElement>(null);
	const inputs = useRef(new Map<string, HTMLTextAreaElement>());
	const pendingFocus = useRef<string | null>(null);
	const pan = useRef<{
		id: number;
		x: number;
		y: number;
		left: number;
		top: number;
	} | null>(null);
	const [panning, setPanning] = useState(false);
	const selected = doc.nodes.find((node) => node.id === selectedId) ?? root;
	const layout = useMemo(() => layoutMindMap(doc), [doc]);
	const movingIds = dragOffset
		? branchIds(doc, dragOffset.id)
		: new Set<string>();
	const visiblePositions = layout.positions.map((entry) =>
		movingIds.has(entry.node.id)
			? {
					...entry,
					x: entry.x + (dragOffset?.x ?? 0),
					y: entry.y + (dragOffset?.y ?? 0),
				}
			: entry,
	);
	useLayoutEffect(() => {
		const id = pendingFocus.current;
		if (!id) return;
		const entry = layout.positions.find(({ node }) => node.id === id);
		const input = inputs.current.get(id);
		const el = viewport.current;
		if (!entry || !input || !el) return;
		setCamera({
			x: el.clientWidth / 2 - (entry.x + 102) * zoom,
			y: el.clientHeight / 2 - (entry.y + 36) * zoom,
		});
		input.focus({ preventScroll: true });
		input.select();
		pendingFocus.current = null;
	}, [layout, zoom]);
	const positions = new Map(
		visiblePositions.map((entry) => [entry.node.id, entry]),
	);
	const colors = new Map<string, string>();
	let colorIndex = 0;
	for (const { node } of layout.positions) {
		const inherited =
			node.parentId === root.id
				? (root.color ?? branchColors[colorIndex % branchColors.length])
				: (colors.get(node.parentId ?? "") ?? "#8465b4");
		if (node.parentId === root.id) colorIndex++;
		colors.set(node.id, node.color ?? inherited);
	}

	const descendants = branchIds(doc, selected.id);
	const centerSelected = () => {
		const entry = positions.get(selected.id);
		const el = viewport.current;
		if (entry && el)
			setCamera({
				x: el.clientWidth / 2 - (entry.x + 102) * zoom,
				y: el.clientHeight / 2 - (entry.y + 36) * zoom,
			});
	};
	const fit = () => {
		const el = viewport.current;
		if (!el) return;
		const minX = Math.min(...layout.positions.map((p) => p.x));
		const minY = Math.min(...layout.positions.map((p) => p.y));
		const maxX = Math.max(...layout.positions.map((p) => p.x + 220));
		const maxY = Math.max(...layout.positions.map((p) => p.y + 88));
		const nextZoom = Math.max(
			0.05,
			Math.min(
				1.5,
				(el.clientWidth - 48) / (maxX - minX),
				(el.clientHeight - 48) / (maxY - minY),
			),
		);
		setZoom(nextZoom);
		setCamera({
			x: (el.clientWidth - (maxX + minX) * nextZoom) / 2,
			y: (el.clientHeight - (maxY + minY) * nextZoom) / 2,
		});
	};
	const changeZoom = (next: number) => {
		const el = viewport.current;
		if (el)
			setCamera({
				x: el.clientWidth / 2 - ((el.clientWidth / 2 - camera.x) * next) / zoom,
				y:
					el.clientHeight / 2 -
					((el.clientHeight / 2 - camera.y) * next) / zoom,
			});
		setZoom(next);
	};
	const parents = new Set(doc.nodes.map((node) => node.parentId));
	const patch = (id: string, changes: Partial<MindMapNode>) =>
		onChange({
			...doc,
			nodes: doc.nodes.map((node) =>
				node.id === id ? { ...node, ...changes } : node,
			),
		});
	const add = (parentId: string) => {
		const id = crypto.randomUUID();
		onChange({
			...doc,
			nodes: [
				...doc.nodes.map((node) =>
					node.id === parentId ? { ...node, collapsed: false } : node,
				),
				{ id, parentId, text: t("visual.topic") },
			],
		});
		pendingFocus.current = id;
		select(id);
	};
	const finishDrag = (cancel = false) => {
		const current = drag.current;
		drag.current = null;
		setDragOffset(null);
		if (!current || cancel || (!current.dx && !current.dy)) return;
		const node = doc.nodes.find((n) => n.id === current.id);
		if (node)
			patch(node.id, {
				offset: {
					x: Math.max(
						-100000,
						Math.min(100000, (node.offset?.x ?? 0) + current.dx),
					),
					y: Math.max(
						-100000,
						Math.min(100000, (node.offset?.y ?? 0) + current.dy),
					),
				},
			});
	};
	return (
		<>
			<div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-background px-3 py-1.5">
				<IconButton
					label={t("visual.addChild")}
					onClick={() => add(selected.id)}
				>
					<GitBranchPlus className="size-4" />
				</IconButton>
				<IconButton
					label={t("visual.addSibling")}
					disabled={!selected.parentId}
					onClick={() => selected.parentId && add(selected.parentId)}
				>
					<Plus className="size-4" />
				</IconButton>
				<IconButton
					label={t("visual.deleteBranch")}
					disabled={!selected.parentId}
					onClick={() => {
						onChange({
							...doc,
							nodes: doc.nodes.filter((node) => !descendants.has(node.id)),
						});
						select(selected.parentId ?? root.id);
					}}
				>
					<Trash2 className="size-4" />
				</IconButton>
				<select
					className={`${fieldClass} max-w-44 text-xs`}
					aria-label={t("visual.parent")}
					disabled={!selected.parentId}
					value={selected.parentId ?? ""}
					onChange={(event) => {
						const parentId = event.target.value;
						onChange({
							...doc,
							nodes: doc.nodes.map((node) =>
								node.id === selected.id
									? { ...node, parentId }
									: node.id === parentId
										? { ...node, collapsed: false }
										: node,
							),
						});
					}}
				>
					{!selected.parentId && <option value="">{t("visual.root")}</option>}
					{doc.nodes
						.filter((node) => !descendants.has(node.id))
						.map((node) => (
							<option key={node.id} value={node.id}>
								{node.text || t("visual.topic")}
							</option>
						))}
				</select>
				<input
					type="color"
					className="size-8 cursor-pointer rounded border bg-transparent p-1"
					aria-label={t("visual.branchColor")}
					title={t("visual.branchColor")}
					value={colors.get(selected.id) ?? "#8b5cf6"}
					onChange={(event) =>
						patch(selected.id, { color: event.target.value })
					}
				/>
				<IconButton
					label={t("visual.resetColor")}
					disabled={!selected.color}
					onClick={() => patch(selected.id, { color: undefined })}
				>
					<RotateCcw className="size-4" />
				</IconButton>
				<IconButton
					label={t("visual.autoLayout")}
					disabled={!doc.nodes.some((node) => node.offset)}
					onClick={() =>
						onChange({
							...doc,
							nodes: doc.nodes.map(({ offset: _offset, ...node }) => node),
						})
					}
				>
					<Network className="size-4" />
				</IconButton>
				<div className="mx-1 h-5 border-l" />
				<IconButton
					label={t("visual.expandAll")}
					disabled={!doc.nodes.some((node) => node.collapsed)}
					onClick={() =>
						onChange({
							...doc,
							nodes: doc.nodes.map((node) => ({ ...node, collapsed: false })),
						})
					}
				>
					<ChevronsUpDown className="size-4" />
				</IconButton>
				<div className="flex-1" />
				<IconButton label={t("visual.centerSelected")} onClick={centerSelected}>
					<Focus className="size-4" />
				</IconButton>
				<IconButton label={t("visual.fitView")} onClick={fit}>
					<Maximize className="size-4" />
				</IconButton>
				<IconButton
					label={t("visual.zoomOut")}
					disabled={zoom <= 0.25}
					onClick={() => changeZoom(Math.max(0.25, zoom - 0.1))}
				>
					<ZoomOut className="size-4" />
				</IconButton>
				<button
					type="button"
					className="rounded px-1 text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-ring"
					aria-label={t("visual.resetZoom")}
					onClick={() => changeZoom(1)}
				>
					{Math.round(zoom * 100)}%
				</button>
				<IconButton
					label={t("visual.zoomIn")}
					disabled={zoom >= 1.5}
					onClick={() => changeZoom(Math.min(1.5, zoom + 0.1))}
				>
					<ZoomIn className="size-4" />
				</IconButton>
			</div>
			<div
				ref={viewport}
				className={`relative min-h-0 flex-1 touch-none overflow-hidden overscroll-contain bg-muted/20 ${panning ? "cursor-grabbing select-none" : "cursor-grab"}`}
				style={{
					backgroundImage:
						"radial-gradient(var(--border) 1px, transparent 1px)",
					backgroundSize: "20px 20px",
					backgroundPosition: `${camera.x}px ${camera.y}px`,
				}}
				onPointerDown={(event) => {
					if (
						event.button !== 0 ||
						(event.target as HTMLElement).closest("[data-node-id]")
					)
						return;
					const el = event.currentTarget;
					pan.current = {
						id: event.pointerId,
						x: event.clientX,
						y: event.clientY,
						left: camera.x,
						top: camera.y,
					};
					el.setPointerCapture(event.pointerId);
					setPanning(true);
				}}
				onPointerMove={(event) => {
					const start = pan.current;
					if (!start || start.id !== event.pointerId) return;
					setCamera({
						x: start.left + event.clientX - start.x,
						y: start.top + event.clientY - start.y,
					});
				}}
				onPointerUp={(event) => {
					if (event.currentTarget.hasPointerCapture(event.pointerId))
						event.currentTarget.releasePointerCapture(event.pointerId);
				}}
				onLostPointerCapture={() => {
					pan.current = null;
					setPanning(false);
				}}
				onWheel={(event) =>
					setCamera((current) => ({
						x: current.x - event.deltaX,
						y: current.y - event.deltaY,
					}))
				}
				data-mind-map
			>
				<div
					data-mind-map-content
					style={{
						transform: `translate(${camera.x}px, ${camera.y}px)`,
						width: 0,
						height: 0,
					}}
				>
					<div
						className="relative origin-top-left"
						style={{
							width: layout.width,
							height: layout.height,
							transform: `scale(${zoom})`,
						}}
					>
						<svg
							width={layout.width}
							height={layout.height}
							className="pointer-events-none absolute inset-0 overflow-visible text-muted-foreground/40"
							aria-hidden="true"
						>
							{visiblePositions.map(({ node, x, y }) => {
								const parent = node.parentId
									? positions.get(node.parentId)
									: null;
								return parent ? (
									<SketchPath
										key={node.id}
										id={node.id}
										d={`M ${parent.x + 204} ${parent.y + 36} C ${parent.x + 230} ${parent.y + 36}, ${x - 26} ${y + 36}, ${x} ${y + 36}`}
										color={colors.get(node.id) ?? "#8465b4"}
									/>
								) : null;
							})}
						</svg>
						{visiblePositions.map(({ node, x, y }) => (
							<div
								key={node.id}
								data-node-id={node.id}
								className={`group absolute flex h-[72px] w-[204px] cursor-default items-center rounded-lg bg-background p-3 focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-ring ${selected.id === node.id ? "outline outline-1 outline-offset-4 outline-ring/50" : ""}`}
								style={{
									left: x,
									top: y,
								}}
							>
								<svg
									aria-hidden="true"
									className="pointer-events-none absolute inset-0 size-full overflow-visible"
									viewBox="0 0 204 72"
								>
									<SketchPath
										id={`box-${node.id}`}
										d="M 10 1 H 194 Q 203 1 203 10 V 62 Q 203 71 194 71 H 10 Q 1 71 1 62 V 10 Q 1 1 10 1 Z"
										color={colors.get(node.id) ?? "#8465b4"}
										fill
									/>
								</svg>
								<IconButton
									label={t("visual.dragTopic")}
									className="-ml-2 mr-1 h-full w-6 shrink-0 touch-none cursor-grab active:cursor-grabbing"
									onPointerDown={(event) => {
										if (event.button !== 0) return;
										event.preventDefault();
										event.stopPropagation();
										event.currentTarget.focus({ preventScroll: true });
										select(node.id);
										drag.current = {
											id: node.id,
											pointer: event.pointerId,
											x: event.clientX,
											y: event.clientY,
											dx: 0,
											dy: 0,
										};
										event.currentTarget.setPointerCapture(event.pointerId);
									}}
									onPointerMove={(event) => {
										const current = drag.current;
										if (!current || current.pointer !== event.pointerId) return;
										event.stopPropagation();
										current.dx = (event.clientX - current.x) / zoom;
										current.dy = (event.clientY - current.y) / zoom;
										setDragOffset({
											id: current.id,
											x: current.dx,
											y: current.dy,
										});
									}}
									onPointerUp={(event) => {
										event.stopPropagation();
										finishDrag();
									}}
									onPointerCancel={() => finishDrag(true)}
									onLostPointerCapture={() => finishDrag(true)}
									onKeyDown={(event) => {
										if (event.key === "Escape") {
											finishDrag(true);
											return;
										}
										const deltas: Record<string, number[]> = {
											ArrowLeft: [-10, 0],
											ArrowRight: [10, 0],
											ArrowUp: [0, -10],
											ArrowDown: [0, 10],
										};
										const delta = deltas[event.key];
										if (!delta) return;
										event.preventDefault();
										event.stopPropagation();
										select(node.id);
										patch(node.id, {
											offset: {
												x: Math.max(
													-100000,
													Math.min(100000, (node.offset?.x ?? 0) + delta[0]),
												),
												y: Math.max(
													-100000,
													Math.min(100000, (node.offset?.y ?? 0) + delta[1]),
												),
											},
										});
									}}
								>
									<GripVertical className="size-4" />
								</IconButton>
								<textarea
									ref={(el) => {
										if (el) inputs.current.set(node.id, el);
										else inputs.current.delete(node.id);
									}}
									aria-label={t("visual.nodeText")}
									title={t("visual.nodeShortcuts")}
									onKeyDown={(event) => {
										if (
											event.nativeEvent.isComposing ||
											event.repeat ||
											event.shiftKey ||
											event.key !== "Enter"
										)
											return;
										if (event.ctrlKey || event.metaKey) {
											event.preventDefault();
											event.stopPropagation();
											add(node.id);
										} else if (event.altKey && node.parentId) {
											event.preventDefault();
											event.stopPropagation();
											add(node.parentId);
										}
									}}
									className="relative h-full min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 outline-none"
									value={node.text}
									onFocus={() => select(node.id)}
									onChange={(event) =>
										patch(node.id, { text: event.target.value })
									}
								/>
								{parents.has(node.id) && (
									<IconButton
										label={t(
											node.collapsed ? "visual.expand" : "visual.collapse",
										)}
										aria-expanded={!node.collapsed}
										onClick={() => {
											select(node.id);
											patch(node.id, { collapsed: !node.collapsed });
										}}
									>
										{node.collapsed ? (
											<span className="flex items-center text-xs tabular-nums">
												<ChevronRight className="size-3" />
												{branchIds(doc, node.id).size - 1}
											</span>
										) : (
											<ChevronDown className="size-4" />
										)}
									</IconButton>
								)}
								{selected.id === node.id && (
									<IconButton
										label={t("visual.quickAddChild")}
										className="absolute -right-4 -bottom-3 size-7 rounded-full border bg-background shadow-sm hover:bg-accent"
										onClick={() => add(node.id)}
									>
										<Plus className="size-3.5" />
									</IconButton>
								)}
							</div>
						))}
					</div>
				</div>
			</div>
			<div className="flex shrink-0 items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
				<span className="tabular-nums">
					{t("visual.visibleTopics", {
						visible: layout.positions.length,
						total: doc.nodes.length,
					})}
				</span>
				<span className="hidden truncate sm:block">
					{t("visual.canvasHint")}
				</span>
			</div>
		</>
	);
}
