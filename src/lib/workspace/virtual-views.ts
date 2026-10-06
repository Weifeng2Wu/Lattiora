export const GRAPH_PATH = "agentero:graph";
export const SEMANTIC_SEARCH_PATH = "agentero:semantic-search";

export function researchViewKind(path: string) {
	if (path === GRAPH_PATH) return "graph" as const;
	if (path === SEMANTIC_SEARCH_PATH) return "semantic-search" as const;
	return null;
}
