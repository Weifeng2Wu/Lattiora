import { z } from "zod";

export type VisualDocumentKind = "mindmap" | "kanban";

export function visualDocumentKind(path: string): VisualDocumentKind | null {
	if (/\.mindmap\.json$/i.test(path)) return "mindmap";
	if (/\.kanban\.json$/i.test(path)) return "kanban";
	return null;
}

const id = z.string().min(1);
const nodeSchema = z
	.object({
		id,
		parentId: id.nullable(),
		text: z.string(),
		collapsed: z.boolean().optional(),
		color: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/)
			.optional(),
		offset: z
			.object({
				x: z.number().finite().min(-100000).max(100000),
				y: z.number().finite().min(-100000).max(100000),
			})
			.strict()
			.optional(),
	})
	.strict();
const mindMapSchema = z
	.object({
		type: z.literal("mindmap"),
		version: z.literal(1),
		nodes: z.array(nodeSchema).min(1),
	})
	.strict();
const cardSchema = z
	.object({ id, title: z.string(), description: z.string() })
	.strict();
const kanbanSchema = z
	.object({
		type: z.literal("kanban"),
		version: z.literal(1),
		columns: z
			.array(
				z
					.object({ id, title: z.string(), cards: z.array(cardSchema) })
					.strict(),
			)
			.min(1),
	})
	.strict();

export type MindMap = z.infer<typeof mindMapSchema>;
export type MindMapNode = MindMap["nodes"][number];
export type Kanban = z.infer<typeof kanbanSchema>;
export type VisualDocument = MindMap | Kanban;

/** Reject unsupported data instead of silently dropping it on the next save. */
export function parseVisualDocument(
	content: string,
	kind: VisualDocumentKind,
): VisualDocument {
	const value = JSON.parse(content);
	if (kind === "kanban") {
		const doc = kanbanSchema.parse(value);
		const ids = doc.columns.flatMap((column) => [
			column.id,
			...column.cards.map((card) => card.id),
		]);
		if (new Set(ids).size !== ids.length) throw new Error("Duplicate IDs");
		return doc;
	}
	const doc = mindMapSchema.parse(value);
	const byId = new Map(doc.nodes.map((node) => [node.id, node]));
	if (
		byId.size !== doc.nodes.length ||
		doc.nodes.filter((node) => node.parentId === null).length !== 1
	)
		throw new Error("Invalid root or duplicate IDs");
	// Iterative traversal also rejects detached cycles, without recursion limits.
	const children = new Map<string | null, MindMapNode[]>();
	for (const node of doc.nodes) {
		const siblings = children.get(node.parentId) ?? [];
		siblings.push(node);
		children.set(node.parentId, siblings);
	}
	const queue = [...(children.get(null) ?? [])];
	for (let index = 0; index < queue.length; index++) {
		queue.push(...(children.get(queue[index].id) ?? []));
		if (queue.length > doc.nodes.length) throw new Error("Cyclic tree");
	}
	if (queue.length !== doc.nodes.length) throw new Error("Disconnected tree");
	return doc;
}

export function createVisualDocument(
	kind: VisualDocumentKind,
	labels: { topic: string; columns: string[] },
): VisualDocument {
	return kind === "mindmap"
		? {
				type: "mindmap",
				version: 1,
				nodes: [
					{ id: crypto.randomUUID(), parentId: null, text: labels.topic },
				],
			}
		: {
				type: "kanban",
				version: 1,
				columns: labels.columns.map((title) => ({
					id: crypto.randomUUID(),
					title,
					cards: [],
				})),
			};
}

export function branchIds(doc: MindMap, rootId: string): Set<string> {
	const children = new Map<string, string[]>();
	for (const node of doc.nodes) {
		if (node.parentId === null) continue;
		const siblings = children.get(node.parentId) ?? [];
		siblings.push(node.id);
		children.set(node.parentId, siblings);
	}
	const ids = new Set([rootId]);
	for (const id of ids)
		for (const child of children.get(id) ?? []) ids.add(child);
	return ids;
}

/** Fixed-size nodes, centered over their visible descendants. */
export function layoutMindMap(doc: MindMap) {
	const children = new Map<string | null, MindMapNode[]>();
	for (const node of doc.nodes) {
		const siblings = children.get(node.parentId) ?? [];
		siblings.push(node);
		children.set(node.parentId, siblings);
	}
	const root = children.get(null)?.[0];
	if (!root) throw new Error("Missing root");
	const queue = [{ node: root, depth: 0 }];
	for (let i = 0; i < queue.length; i++) {
		const entry = queue[i];
		if (!entry.node.collapsed)
			for (const child of children.get(entry.node.id) ?? [])
				queue.push({ node: child, depth: entry.depth + 1 });
	}
	const heights = new Map<string, number>();
	for (let i = queue.length - 1; i >= 0; i--) {
		const { node } = queue[i];
		heights.set(
			node.id,
			node.collapsed
				? 104
				: Math.max(
						104,
						(children.get(node.id) ?? []).reduce(
							(sum, child) => sum + (heights.get(child.id) ?? 0),
							0,
						),
					),
		);
	}
	const tops = new Map([[root.id, 24]]);
	const offsets = new Map<string, { x: number; y: number }>();
	const positions = queue.map(({ node, depth }) => {
		const top = tops.get(node.id) ?? 24;
		let nextTop = top;
		for (const child of children.get(node.id) ?? []) {
			tops.set(child.id, nextTop);
			nextTop += heights.get(child.id) ?? 0;
		}
		const parentOffset = offsets.get(node.parentId ?? "") ?? { x: 0, y: 0 };
		const offset = {
			x: parentOffset.x + (node.offset?.x ?? 0),
			y: parentOffset.y + (node.offset?.y ?? 0),
		};
		offsets.set(node.id, offset);
		return {
			node,
			x: 24 + depth * 252 + offset.x,
			y: top + (heights.get(node.id) ?? 104) / 2 - 36 + offset.y,
		};
	});
	return {
		positions,
		width: positions.reduce((max, p) => Math.max(max, p.x), 0) + 228,
		height: (heights.get(root.id) ?? 104) + 48,
	};
}

/** Insert before a card, or append. Works within a column and across columns. */
export function moveKanbanCard(
	doc: Kanban,
	cardId: string,
	columnId: string,
	beforeId?: string,
): Kanban {
	const card = doc.columns
		.flatMap((column) => column.cards)
		.find((entry) => entry.id === cardId);
	const target = doc.columns.find((column) => column.id === columnId);
	if (
		!card ||
		!target ||
		beforeId === cardId ||
		(beforeId && !target.cards.some((entry) => entry.id === beforeId))
	)
		return doc;
	return {
		...doc,
		columns: doc.columns.map((column) => {
			const cards = column.cards.filter((entry) => entry.id !== cardId);
			if (column.id === columnId)
				cards.splice(
					beforeId
						? cards.findIndex((entry) => entry.id === beforeId)
						: cards.length,
					0,
					card,
				);
			return { ...column, cards };
		}),
	};
}
