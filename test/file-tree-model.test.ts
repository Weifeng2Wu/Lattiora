import { describe, expect, it } from "vitest";
import { resolveTreeHighlightPath } from "@/components/sidebar/file-tree/hooks/use-tree-model";
import { pathKey } from "@/components/sidebar/file-tree/tree-helpers";
import { LIBRARY_VIRTUAL_PATH, TRASH_VIRTUAL_PATH } from "@/lib/paper/api";
import type { FileNode } from "@/lib/vault";

function dir(path: string, name: string, children: FileNode[] = []): FileNode {
	return { id: path, name, path, kind: "directory", children };
}

const nodes: FileNode[] = [
	dir("/vault/papers", "papers", [
		dir("/vault/papers/1706.03762", "1706.03762"),
	]),
	dir("/vault/notes", "notes"),
];
const byPathKey = new Map<string, FileNode>();
const walk = (list: FileNode[]) => {
	for (const n of list) {
		byPathKey.set(pathKey(n.path), n);
		if (n.children) walk(n.children);
	}
};
walk(nodes);

describe("resolveTreeHighlightPath", () => {
	it("maps the library virtual path to the papers/ folder row", () => {
		expect(resolveTreeHighlightPath(LIBRARY_VIRTUAL_PATH, byPathKey)).toBe(
			"/vault/papers",
		);
	});

	it("keeps other virtual paths as-is", () => {
		expect(resolveTreeHighlightPath(TRASH_VIRTUAL_PATH, byPathKey)).toBe(
			TRASH_VIRTUAL_PATH,
		);
	});

	it("resolves a path to its nearest existing directory", () => {
		expect(
			resolveTreeHighlightPath("/vault/papers/1706.03762/gone.md", byPathKey),
		).toBe("/vault/papers/1706.03762");
	});
});
