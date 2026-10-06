import { describe, expect, it } from "vitest";
import { resolveTreeHighlightPath } from "@/components/sidebar/file-tree/hooks/use-tree-model";
import {
	isTreeExpandableDirectory,
	pathKey,
	visibleTreeChildren,
} from "@/components/sidebar/file-tree/tree-helpers";
import {
	directoryHasPaperMarkers,
	isPaperDirectory,
	paperDirFromPath,
	paperHasLocalPdf,
} from "@/lib/paper";
import {
	isPaperAttachmentsRoot,
	isUnderPaperAttachments,
	paperAttachmentChildren,
	paperAttachmentsNode,
	paperHasVisibleAttachments,
} from "@/lib/paper/attachments";
import { isPaperAssetPath } from "@/lib/paper/paths";
import type { FileNode } from "@/lib/vault";

function dir(
	path: string,
	children: FileNode[] = [],
	extra?: Partial<FileNode>,
): FileNode {
	const name = path.split("/").pop() ?? path;
	return { id: path, name, path, kind: "directory", children, ...extra };
}

function file(path: string): FileNode {
	const name = path.split("/").pop() ?? path;
	return { id: path, name, path, kind: "file" };
}

function paperWith(
	children: FileNode[],
	paperPath = "/v/papers/1706.03762",
): FileNode {
	return dir(paperPath, [file(`${paperPath}/NOTES.md`), ...children]);
}

function indexByPathKey(root: FileNode): Map<string, FileNode> {
	const map = new Map<string, FileNode>();
	const walk = (n: FileNode) => {
		map.set(pathKey(n.path), n);
		for (const child of n.children ?? []) walk(child);
	};
	walk(root);
	return map;
}

describe("paper attachments helpers", () => {
	it("does not treat attachments-only folders as papers", () => {
		expect(
			directoryHasPaperMarkers([{ name: "attachments", kind: "directory" }]),
		).toBe(false);
		expect(
			isPaperDirectory("/v/papers/extra", [
				{ name: "attachments", kind: "directory" },
			]),
		).toBe(false);
	});

	it("still treats NOTES + attachments as a paper unit", () => {
		expect(
			directoryHasPaperMarkers([
				{ name: "NOTES.md", kind: "file" },
				{ name: "attachments", kind: "directory" },
			]),
		).toBe(true);
	});

	it("resolves paperDirFromPath for attachments files", () => {
		expect(
			paperDirFromPath(
				"/vault/papers/nlp/1706.03762/attachments/supplement.pdf",
			),
		).toBe("/vault/papers/nlp/1706.03762");
		expect(paperDirFromPath("papers/a/b/attachments/code/main.py")).toBe(
			"papers/a/b",
		);
	});

	it("does not walk attachments when looking for nested papers", () => {
		expect(
			directoryHasPaperMarkers([
				{ name: "NOTES.md", kind: "file" },
				{
					name: "attachments",
					kind: "directory",
					children: [
						{
							name: "nested",
							kind: "directory",
							children: [{ name: "NOTES.md", kind: "file" }],
						},
					],
				},
			]),
		).toBe(true);
	});

	it("finds the attachments bucket and its children", () => {
		const paper = paperWith([
			dir("/v/papers/1706.03762/source", [
				file("/v/papers/1706.03762/source/main.tex"),
			]),
			dir("/v/papers/1706.03762/attachments", [
				file("/v/papers/1706.03762/attachments/supplement.pdf"),
				dir("/v/papers/1706.03762/attachments/code"),
			]),
		]);
		expect(paperAttachmentsNode(paper)?.path).toBe(
			"/v/papers/1706.03762/attachments",
		);
		expect(paperHasVisibleAttachments(paper)).toBe(true);
		expect(paperAttachmentChildren(paper).map((n) => n.name)).toEqual([
			"supplement.pdf",
			"code",
		]);
	});

	it("hides the chevron when attachments is missing or empty", () => {
		expect(paperHasVisibleAttachments(paperWith([]))).toBe(false);
		expect(
			paperHasVisibleAttachments(
				paperWith([dir("/v/papers/1706.03762/attachments", [])]),
			),
		).toBe(false);
		expect(
			paperHasVisibleAttachments(
				paperWith([
					dir("/v/papers/1706.03762/attachments", [], {
						childrenPending: true,
					}),
				]),
			),
		).toBe(true);
	});

	it("classifies surfaced vs bucket paths", () => {
		const paper = "/v/papers/1706.03762";
		expect(isPaperAttachmentsRoot(`${paper}/attachments`, paper)).toBe(true);
		expect(isUnderPaperAttachments(`${paper}/attachments`, paper)).toBe(false);
		expect(
			isUnderPaperAttachments(`${paper}/attachments/supplement.pdf`, paper),
		).toBe(true);
		expect(isUnderPaperAttachments(`${paper}/NOTES.md`, paper)).toBe(false);
		expect(isPaperAssetPath(`${paper}/attachments/supplement.pdf`)).toBe(true);
		expect(isPaperAssetPath(`${paper}/NOTES.md`)).toBe(false);
	});

	it("does not count attachment PDFs as the paper body PDF", () => {
		const paper = paperWith([
			dir("/v/papers/1706.03762/attachments", [
				file("/v/papers/1706.03762/attachments/supplement.pdf"),
			]),
		]);
		expect(paperHasLocalPdf(paper)).toBe(false);
		expect(
			paperHasLocalPdf(
				paperWith([file("/v/papers/1706.03762/1706.03762.pdf")]),
			),
		).toBe(true);
	});
});

describe("paper attachment tree rows", () => {
	const paper = paperWith([
		file("/v/papers/1706.03762/PAPER.md"),
		dir("/v/papers/1706.03762/source", [
			file("/v/papers/1706.03762/source/main.tex"),
		]),
		dir("/v/papers/1706.03762/attachments", [
			file("/v/papers/1706.03762/attachments/supplement.pdf"),
			dir("/v/papers/1706.03762/attachments/code", [
				file("/v/papers/1706.03762/attachments/code/main.py"),
			]),
		]),
	]);

	it("surfaces paper notes and attachments and stays expandable", () => {
		expect(visibleTreeChildren(paper).map((n) => n.name)).toEqual([
			"NOTES.md",
			"supplement.pdf",
			"code",
		]);
		expect(isTreeExpandableDirectory(paper)).toBe(true);
		expect(isTreeExpandableDirectory(paperWith([]))).toBe(true);
	});

	it("highlights attachment files, not the paper leaf", () => {
		const byPathKey = indexByPathKey(paper);
		expect(
			resolveTreeHighlightPath(
				"/v/papers/1706.03762/attachments/supplement.pdf",
				byPathKey,
			),
		).toBe("/v/papers/1706.03762/attachments/supplement.pdf");
		expect(
			resolveTreeHighlightPath(
				"/v/papers/1706.03762/attachments/code/main.py",
				byPathKey,
			),
		).toBe("/v/papers/1706.03762/attachments/code/main.py");
		expect(
			resolveTreeHighlightPath("/v/papers/1706.03762/NOTES.md", byPathKey),
		).toBe("/v/papers/1706.03762/NOTES.md");
		expect(
			resolveTreeHighlightPath("/v/papers/1706.03762/attachments", byPathKey),
		).toBe("/v/papers/1706.03762");
	});
});
