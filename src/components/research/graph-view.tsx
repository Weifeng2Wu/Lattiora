import {
	ArrowUpRight,
	Focus,
	Maximize,
	Minus,
	Network,
	Plus,
	RefreshCw,
	X,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/viewer/visual/controls";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import { loadResearchGraph } from "@/lib/cloud/graph";
import { notifyError } from "@/lib/core/notify";
import {
	filterGraph,
	layoutGraph,
	type ResearchGraph,
} from "@/lib/graph/model";
import { openGraphPath } from "@/lib/workspace/actions";

const empty: ResearchGraph = { nodes: [], edges: [], unavailable: 0 };
type Point = { x: number; y: number };
type Camera = Point & { zoom: number };

export function GraphView({
	active = true,
	onOpenFile,
}: {
	active?: boolean;
	onOpenFile?: (path: string) => void;
}) {
	const { t } = useTranslation(["app", "viewer"]);
	const markerId = useId().replace(/:/g, "");
	const [graph, setGraph] = useState(empty);
	const [loading, setLoading] = useState(true);
	const [revision, setRevision] = useState(0);
	const [query, setQuery] = useState("");
	const [focus, setFocus] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [links, setLinks] = useState(true);
	const [citations, setCitations] = useState(true);
	const viewport = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 800, height: 600 });
	const [camera, setCamera] = useState<Camera>({ x: 400, y: 300, zoom: 1 });
	const [offsets, setOffsets] = useState<Map<string, Point>>(new Map());
	const drag = useRef<{
		pointer: number;
		start: Point;
		camera: Camera;
		id: string | null;
		point: Point;
		moved: boolean;
	} | null>(null);
	const suppressClick = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly requests a reload.
	useEffect(() => {
		if (!active) return;
		let disposed = false;
		let generation = 0;
		let timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			const current = ++generation;
			setLoading(true);
			try {
				const next = await loadResearchGraph();
				if (disposed || current !== generation) return;
				setGraph(next);
				if (next.unavailable)
					notifyError(
						t("research.graph.unavailable", { count: next.unavailable }),
						{ id: "graph-load" },
					);
			} catch {
				if (!disposed && current === generation)
					notifyError(t("research.graph.failed"), { id: "graph-load" });
			} finally {
				if (!disposed && current === generation) setLoading(false);
			}
		};
		void refresh();
		const unsubscribe = subscribeCloudFiles((paths) => {
			if (
				!paths.some(
					(path) =>
						/\.(md|mdx|markdown|pdf)$/i.test(path) ||
						path.endsWith("/.paper.json") ||
						path.endsWith("/agentero-cite.json") ||
						!path.includes("."),
				)
			)
				return;
			generation++;
			clearTimeout(timer);
			timer = setTimeout(() => void refresh(), 350);
		});
		return () => {
			disposed = true;
			clearTimeout(timer);
			unsubscribe();
		};
	}, [active, revision, t]);
	const view = useMemo(
		() => filterGraph(graph, { query, focus, links, citations }),
		[graph, query, focus, links, citations],
	);
	const layout = useMemo(() => layoutGraph(view.nodes, view.edges), [view]);
	const points = useMemo(
		() =>
			new Map([...layout].map(([id, point]) => [id, offsets.get(id) ?? point])),
		[layout, offsets],
	);
	const fit = useCallback(() => {
		const values = [...points.values()];
		const minX = Math.min(0, ...values.map((p) => p.x)) - 100;
		const maxX = Math.max(0, ...values.map((p) => p.x)) + 100;
		const minY = Math.min(0, ...values.map((p) => p.y)) - 70;
		const maxY = Math.max(0, ...values.map((p) => p.y)) + 70;
		const zoom = Math.max(
			0.1,
			Math.min(1.5, size.width / (maxX - minX), size.height / (maxY - minY)),
		);
		setCamera({
			zoom,
			x: size.width / 2 - ((minX + maxX) / 2) * zoom,
			y: size.height / 2 - ((minY + maxY) / 2) * zoom,
		});
	}, [points, size]);
	const fitRef = useRef(fit);
	fitRef.current = fit;
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset manually dragged positions when the graph layout changes.
	useEffect(() => {
		setOffsets(new Map());
		fitRef.current();
	}, [layout]);
	useEffect(() => {
		const element = viewport.current;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			if (element.clientWidth && element.clientHeight)
				setSize({ width: element.clientWidth, height: element.clientHeight });
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: fit on viewport resize, not on each drag.
	useEffect(() => {
		fitRef.current();
	}, [size]);
	const zoomAt = useCallback(
		(factor: number, point: Point) =>
			setCamera((previous) => {
				const zoom = Math.max(0.1, Math.min(3, previous.zoom * factor));
				const ratio = zoom / previous.zoom;
				return {
					zoom,
					x: point.x - (point.x - previous.x) * ratio,
					y: point.y - (point.y - previous.y) * ratio,
				};
			}),
		[],
	);
	useEffect(() => {
		const element = viewport.current;
		if (!element) return;
		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			const bounds = element.getBoundingClientRect();
			zoomAt(Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.003), {
				x: event.clientX - bounds.left,
				y: event.clientY - bounds.top,
			});
		};
		element.addEventListener("wheel", wheel, { passive: false });
		return () => element.removeEventListener("wheel", wheel);
	}, [zoomAt]);
	const node = graph.nodes.find((item) => item.id === selected);
	const adjacent = new Set([selected]);
	for (const edge of view.edges) {
		if (edge.source === selected) adjacent.add(edge.target);
		if (edge.target === selected) adjacent.add(edge.source);
	}
	const open = (path: string) =>
		onOpenFile ? onOpenFile(path) : openGraphPath(path);
	return (
		<section
			className="flex h-full min-h-0 min-w-0 flex-col bg-background"
			aria-label={t("research.graph.title")}
			data-research-graph
		>
			<div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
				<Input
					className="h-8 min-w-32 flex-1 basis-40"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setFocus(null);
					}}
					aria-label={t("research.graph.search")}
					placeholder={t("research.graph.search")}
				/>
				{(
					[
						["links", links, setLinks],
						["citations", citations, setCitations],
					] as const
				).map(([key, checked, set]) => (
					<Button
						key={key}
						size="sm"
						variant={checked ? "secondary" : "ghost"}
						aria-pressed={checked}
						onClick={() => set(!checked)}
					>
						{t(`research.graph.${key}`)}
					</Button>
				))}
				<IconButton
					label={t("research.refresh")}
					disabled={loading}
					onClick={() => setRevision((n) => n + 1)}
				>
					<RefreshCw
						className={loading ? "animate-spin motion-reduce:animate-none" : ""}
					/>
				</IconButton>
			</div>
			<div
				ref={viewport}
				className="relative min-h-0 flex-1 overflow-hidden overscroll-contain touch-none bg-muted/10"
			>
				{/* biome-ignore lint/a11y/useSemanticElements: interactive SVG requires a group rather than an HTML fieldset. */}
				<svg
					className="h-full w-full select-none"
					role="group"
					aria-label={t("research.graph.canvas")}
					data-graph-canvas
					onPointerDown={(event) => {
						if (event.button !== 0 || drag.current) return;
						const id =
							(event.target as Element)
								.closest("[data-node-id]")
								?.getAttribute("data-node-id") ?? null;
						drag.current = {
							pointer: event.pointerId,
							start: { x: event.clientX, y: event.clientY },
							camera,
							id,
							point: (id && points.get(id)) || { x: 0, y: 0 },
							moved: false,
						};
						suppressClick.current = false;
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						const current = drag.current;
						if (!current || current.pointer !== event.pointerId) return;
						const dx = event.clientX - current.start.x,
							dy = event.clientY - current.start.y;
						if (Math.hypot(dx, dy) > 4) current.moved = true;
						if (!current.moved) return;
						if (current.id)
							setOffsets((old) =>
								new Map(old).set(current.id!, {
									x: current.point.x + dx / current.camera.zoom,
									y: current.point.y + dy / current.camera.zoom,
								}),
							);
						else
							setCamera({
								...current.camera,
								x: current.camera.x + dx,
								y: current.camera.y + dy,
							});
					}}
					onPointerUp={(event) => {
						const current = drag.current;
						if (!current || current.pointer !== event.pointerId) return;
						suppressClick.current = current.moved;
						if (!current.moved) setSelected(current.id);
						drag.current = null;
						event.currentTarget.releasePointerCapture(event.pointerId);
					}}
					onPointerCancel={() => {
						drag.current = null;
					}}
					onLostPointerCapture={() => {
						drag.current = null;
					}}
				>
					<title>{t("research.graph.canvas")}</title>
					<defs>
						<marker
							id={markerId}
							markerWidth="7"
							markerHeight="7"
							refX="18"
							refY="3"
							orient="auto"
							markerUnits="userSpaceOnUse"
						>
							<path d="M0,0 L6,3 L0,6" fill="currentColor" />
						</marker>
					</defs>
					<g
						transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}
						data-graph-camera
					>
						{view.edges.map((edge) => {
							const a = points.get(edge.source),
								b = points.get(edge.target);
							if (!a || !b) return null;
							return (
								<line
									key={JSON.stringify(edge)}
									x1={a.x}
									y1={a.y}
									x2={b.x}
									y2={b.y}
									stroke="currentColor"
									className={
										edge.kind === "citation"
											? "text-primary/55"
											: "text-muted-foreground/35"
									}
									strokeWidth={1.2}
									strokeDasharray={edge.kind === "citation" ? undefined : "4 4"}
									markerEnd={`url(#${markerId})`}
									opacity={
										selected &&
										edge.source !== selected &&
										edge.target !== selected
											? 0.15
											: 1
									}
									data-edge-kind={edge.kind}
								/>
							);
						})}
						{view.nodes.map((item) => {
							const point = points.get(item.id);
							if (!point) return null;
							return (
								// biome-ignore lint/a11y/useSemanticElements: SVG nodes have keyboard handlers and cannot be HTML buttons.
								<g
									key={item.id}
									transform={`translate(${point.x} ${point.y})`}
									role="button"
									tabIndex={0}
									aria-label={item.title}
									aria-pressed={selected === item.id}
									data-node-id={item.id}
									className="group cursor-grab outline-none focus-visible:text-primary"
									opacity={selected && !adjacent.has(item.id) ? 0.25 : 1}
									onClick={() => {
										if (!suppressClick.current) setSelected(item.id);
									}}
									onDoubleClick={() => {
										if (!suppressClick.current) open(item.id);
									}}
									onKeyDown={(event) => {
										if (event.nativeEvent.isComposing) return;
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											setSelected(item.id);
										}
									}}
								>
									<title>{`${item.title}\n${item.id}`}</title>
									<circle
										r={23}
										fill="transparent"
										stroke="currentColor"
										strokeWidth={2}
										className={
											selected === item.id
												? "text-primary/45"
												: "text-transparent group-hover:text-muted-foreground/30 group-focus-visible:text-ring"
										}
									/>
									{item.kind === "paper" ? (
										<circle r={8} className="fill-primary" />
									) : (
										<rect
											x={-6}
											y={-6}
											width={12}
											height={12}
											rx={3}
											className="fill-muted-foreground"
										/>
									)}
									<text
										y={29}
										textAnchor="middle"
										fill="currentColor"
										className="text-[11px]"
									>
										{item.title.length > 28
											? `${item.title.slice(0, 27)}…`
											: item.title}
									</text>
								</g>
							);
						})}
					</g>
				</svg>
				{!view.nodes.length && (
					<p className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
						{t(loading ? "home.loading" : "research.graph.empty")}
					</p>
				)}
				<div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground pointer-events-none">
					<Network className="size-4" />
					<span>
						{t("research.graph.count", {
							nodes: view.nodes.length,
							edges: view.edges.length,
						})}
					</span>
				</div>
				<div className="absolute bottom-3 left-3 flex rounded-lg border bg-background/95 p-1 shadow-sm">
					<IconButton
						label={t("viewer:visual.zoomOut")}
						onClick={() =>
							zoomAt(0.8, { x: size.width / 2, y: size.height / 2 })
						}
					>
						<Minus />
					</IconButton>
					<IconButton
						label={t("viewer:visual.zoomIn")}
						onClick={() =>
							zoomAt(1.25, { x: size.width / 2, y: size.height / 2 })
						}
					>
						<Plus />
					</IconButton>
					<IconButton label={t("viewer:visual.fitView")} onClick={fit}>
						<Maximize />
					</IconButton>
					{focus && (
						<IconButton
							label={t("research.graph.global")}
							onClick={() => {
								setFocus(null);
								setSelected(null);
							}}
						>
							<Network />
						</IconButton>
					)}
				</div>
				{node && (
					<div
						className="absolute bottom-14 right-3 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border bg-background/95 p-4 shadow-sm sm:bottom-3"
						data-graph-selection
					>
						<div className="flex items-start gap-2">
							<p className="min-w-0 flex-1 break-words text-sm font-medium">
								{node.title}
							</p>
							<IconButton
								label={t("research.close")}
								onClick={() => setSelected(null)}
							>
								<X />
							</IconButton>
						</div>
						<p
							className="mt-1 truncate text-xs text-muted-foreground"
							title={node.id}
						>
							{node.id}
						</p>
						<div className="mt-3 flex gap-2">
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									setFocus(node.id);
									setQuery("");
								}}
							>
								<Focus className="size-4" />
								{t("research.graph.focus")}
							</Button>
							<Button size="sm" onClick={() => open(node.id)}>
								{t("research.open")}
								<ArrowUpRight className="size-4" />
							</Button>
						</div>
					</div>
				)}
			</div>
			{view.total > view.nodes.length && (
				<p className="border-t px-3 py-2 text-xs text-muted-foreground">
					{t("research.graph.limited", {
						count: view.nodes.length,
						total: view.total,
					})}
				</p>
			)}
		</section>
	);
}
