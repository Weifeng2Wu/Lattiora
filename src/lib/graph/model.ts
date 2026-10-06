import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	type SimulationNodeDatum,
} from "d3-force";

export type GraphNode = { id: string; title: string; kind: "paper" | "note" };
export type GraphEdge = {
	source: string;
	target: string;
	kind: "link" | "citation";
};
export type ResearchGraph = {
	nodes: GraphNode[];
	edges: GraphEdge[];
	unavailable: number;
};
export type GraphFilter = {
	query: string;
	focus: string | null;
	links: boolean;
	citations: boolean;
};

/** Filter before limiting so any document remains reachable in a large workspace. */
export function filterGraph(
	graph: ResearchGraph,
	filter: GraphFilter,
	limit = 300,
) {
	const edges = graph.edges.filter((edge) =>
		edge.kind === "link" ? filter.links : filter.citations,
	);
	const query = filter.query.trim().toLocaleLowerCase();
	let selected: Set<string> | null = null;
	if (filter.focus || query) {
		const seeds = new Set(
			graph.nodes
				.filter((node) =>
					filter.focus
						? node.id === filter.focus
						: `${node.title} ${node.id}`.toLocaleLowerCase().includes(query),
				)
				.map((node) => node.id),
		);
		selected = new Set(seeds);
		for (const edge of edges) {
			if (seeds.has(edge.source)) selected.add(edge.target);
			if (seeds.has(edge.target)) selected.add(edge.source);
		}
	}
	const candidates = graph.nodes.filter(
		(node) => !selected || selected.has(node.id),
	);
	const nodes = candidates.slice(0, limit);
	const visible = new Set(nodes.map((node) => node.id));
	return {
		nodes,
		edges: edges.filter(
			(edge) => visible.has(edge.source) && visible.has(edge.target),
		),
		total: candidates.length,
	};
}

/** A bounded, deterministic layout; never leave a force timer running in a hidden tab. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]) {
	const points: Array<GraphNode & SimulationNodeDatum> = nodes.map((node) => ({
		...node,
	}));
	const simulation = forceSimulation(points)
		.force(
			"link",
			forceLink(edges.map((edge) => ({ ...edge })))
				.id((node) => (node as GraphNode).id)
				.distance(140),
		)
		.force("charge", forceManyBody().strength(-320))
		.force("collide", forceCollide(44))
		.force("center", forceCenter(0, 0))
		.stop();
	simulation.tick(160);
	return new Map(
		points.map((point) => [point.id, { x: point.x ?? 0, y: point.y ?? 0 }]),
	);
}
