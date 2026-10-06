import { describe, expect, it } from "vitest";
import { displayPath, joinPath } from "@/lib/core/path";
import { joinVaultPath } from "@/lib/vault";

describe("displayPath", () => {
	it.each([
		[
			String.raw`\\?\D:\Documents\Zotero\papers\2-Areas`,
			String.raw`D:\Documents\Zotero\papers\2-Areas`,
		],
		[
			String.raw`\\?\d:\中文 Vault & 资料\笔记.md`,
			String.raw`d:\中文 Vault & 资料\笔记.md`,
		],
		["\\\\?\\D:\\", "D:\\"],
		[String.raw`\\?\UNC\server\share\notes`, String.raw`\\server\share\notes`],
		[String.raw`\\?\unc\server\share`, String.raw`\\server\share`],
		[String.raw`D:\Documents\Zotero`, String.raw`D:\Documents\Zotero`],
		[String.raw`\\server\share`, String.raw`\\server\share`],
		[String.raw`\\?\Volume{abc}\notes`, String.raw`\\?\Volume{abc}\notes`],
		[String.raw`\\.\C:\notes`, String.raw`\\.\C:\notes`],
		["/home/me/vault", "/home/me/vault"],
		["remote:session/notes", "remote:session/notes"],
		["", ""],
	])("formats %s for display and copying", (path, expected) => {
		expect(displayPath(path)).toBe(expected);
	});
});

describe("joinPath", () => {
	it("joins POSIX roots with forward slashes", () => {
		expect(joinPath("/Users/me/vault", "notes/a.md")).toBe(
			"/Users/me/vault/notes/a.md",
		);
		expect(joinPath("/Users/me/vault/", "notes/a.md")).toBe(
			"/Users/me/vault/notes/a.md",
		);
	});

	it("keeps Windows roots on backslashes for multi-segment rel paths", () => {
		// Regression for #181: mixed C:\\vault/notes/x.md breaks under \\\\?\\ opens.
		expect(
			joinPath(
				"C:\\Users\\hiclary\\Desktop\\wenxian",
				"notes/zh-CN/02 Agent 与 Skill.md",
			),
		).toBe(
			"C:\\Users\\hiclary\\Desktop\\wenxian\\notes\\zh-CN\\02 Agent 与 Skill.md",
		);
		expect(
			joinPath("C:\\Users\\hiclary\\Desktop\\wenxian\\", "notes/a.md"),
		).toBe("C:\\Users\\hiclary\\Desktop\\wenxian\\notes\\a.md");
	});

	it("rewrites child backslashes when the parent is POSIX", () => {
		expect(joinPath("/vault", "notes\\a.md")).toBe("/vault/notes/a.md");
	});

	it("returns the parent when the child is empty", () => {
		expect(joinPath("C:\\vault", "")).toBe("C:\\vault");
		expect(joinPath("C:\\vault\\", "/")).toBe("C:\\vault");
	});
});

describe("joinVaultPath", () => {
	it("preserves extended Windows paths for filesystem IO", () => {
		const path = joinVaultPath(
			String.raw`\\?\D:\Documents\Zotero`,
			"notes/资料.md",
		);
		expect(path).toBe(String.raw`\\?\D:\Documents\Zotero\notes\资料.md`);
		expect(displayPath(path)).toBe(
			String.raw`D:\Documents\Zotero\notes\资料.md`,
		);
	});

	it("matches joinPath for wiki open targets", () => {
		expect(
			joinVaultPath("C:\\Users\\me\\vault", "notes/zh-CN/02 Agent 与 Skill.md"),
		).toBe("C:\\Users\\me\\vault\\notes\\zh-CN\\02 Agent 与 Skill.md");
	});
});
