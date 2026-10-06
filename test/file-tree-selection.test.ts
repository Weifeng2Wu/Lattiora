import { describe, expect, it } from "vitest";
import { normalizeTreeSelection } from "@/components/sidebar/file-tree/tree-helpers";

describe("normalizeTreeSelection", () => {
	it("keeps only top-level semantic targets while preserving order", () => {
		expect(
			normalizeTreeSelection([
				"/vault/papers/nlp/paper-a/attachments/supplement.pdf",
				"/vault/notes/todo.md",
				"/vault/papers/nlp/paper-a",
				"/vault/papers/vision/paper-b",
			]),
		).toEqual([
			"/vault/notes/todo.md",
			"/vault/papers/nlp/paper-a",
			"/vault/papers/vision/paper-b",
		]);
	});

	it("normalizes Windows separators, case, trailing slashes, and duplicates", () => {
		expect(
			normalizeTreeSelection([
				"C:\\Vault\\Papers\\NLP",
				"c:/vault/papers/nlp/paper-a",
				"C:/VAULT/PAPERS/NLP/",
				"C:/Vault/Papers/NLP-Archive",
			]),
		).toEqual(["C:\\Vault\\Papers\\NLP", "C:/Vault/Papers/NLP-Archive"]);
	});
});
