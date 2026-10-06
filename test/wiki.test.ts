import { describe, expect, it } from "vitest";
import {
	externalRenameRepairHadZeroWrites,
	externalRenameRepairNeeded,
	extractWikilinks,
	isVaultLocalMarkdownLink,
	isWikiTargetPath,
	parseWikiHref,
	renameMayAffectWikiTargets,
	resolveDemoWikiReference,
	resolveWikiTarget,
	rewriteWikilinksForPreview,
	toVaultRelative,
	WIKI_HREF_PREFIX,
	wikiNavigationDestination,
} from "@/lib/wiki";
import semanticFixture from "./fixtures/wikilinks/semantic-cases.json";
import { createTestVault } from "./helpers/create-test-vault";

describe("wikilink extraction", () => {
	it("uses the shared semantic fixture without parsing code examples", () => {
		const source = semanticFixture.documents.find(
			(document) => document.path === "notes/Source.md",
		)?.content;
		expect(source).toBeTruthy();
		const links = extractWikilinks(source ?? "");
		expect(links.map((link) => link.targetRaw)).toEqual([
			"notes/Target",
			"",
			"",
			"notes/Target",
		]);
		expect(links[3]?.embed).toBe(true);
	});

	it("extracts typed fragments while skipping inline and fenced code", () => {
		const links = extractWikilinks(
			[
				"See [[notes/Target#Intro|Target Note]] and `[[ignored-inline]]`.",
				"```",
				"[[ignored-fence]]",
				"```",
				"Then [[Loose Note]].",
			].join("\n"),
		);

		expect(links).toHaveLength(2);
		expect(links[0]).toMatchObject({
			targetRaw: "notes/Target",
			fragment: { kind: "heading", path: ["Intro"] },
			alias: "Target Note",
			line: 1,
		});
		expect(links[1]).toMatchObject({
			targetRaw: "Loose Note",
			line: 5,
		});
	});

	it("accepts same-file heading and block fragments", () => {
		const links = extractWikilinks("[[#Root#Child]] and [[#^summary]]");
		expect(links).toMatchObject([
			{ targetRaw: "", fragment: { kind: "heading", path: ["Root", "Child"] } },
			{ targetRaw: "", fragment: { kind: "block", id: "summary" } },
		]);
	});

	it("retains malformed block fragments so navigation can report invalidFragment", () => {
		const links = extractWikilinks("[[#^bad id]] and [[Target#^also-bad!]]");
		expect(links).toMatchObject([
			{ targetRaw: "", fragment: { kind: "block", id: "bad id" } },
			{ targetRaw: "Target", fragment: { kind: "block", id: "also-bad!" } },
		]);
	});
});

describe("wikilink resolution", () => {
	it("keeps the browser demo aligned with the shared semantic fixture", () => {
		for (const fixtureCase of semanticFixture.cases) {
			const result = resolveDemoWikiReference(
				fixtureCase.source,
				fixtureCase.link,
				semanticFixture.documents,
				fixtureCase.syntax ?? "wikilink",
			);
			expect(result.status, fixtureCase.link).toBe(fixtureCase.status);
			expect(result.targetPath, fixtureCase.link).toBe(fixtureCase.path);
		}
	});

	it("resolves targets against markdown files in a real vault directory", async () => {
		const vault = await createTestVault({
			"notes/Index.md": "[[Target]] [[Case]]",
			"notes/Target.md": "# Target",
			"papers/Case.MD": "# Case",
		});

		try {
			const files = await vault.listMarkdownFiles();
			expect(resolveWikiTarget("notes/Target", files)).toBe("notes/Target.md");
			expect(resolveWikiTarget("target", files)).toBe("notes/Target.md");
			expect(resolveWikiTarget("papers/case", files)).toBe("papers/Case.MD");
			expect(toVaultRelative(vault.root, `${vault.root}/notes/Index.md`)).toBe(
				"notes/Index.md",
			);
		} finally {
			await vault.cleanup();
		}
	});

	it("does not resolve ambiguous stem matches", async () => {
		const vault = await createTestVault({
			"a/Duplicate.md": "# A",
			"b/Duplicate.md": "# B",
		});

		try {
			const files = await vault.listMarkdownFiles();
			expect(resolveWikiTarget("Duplicate", files)).toBeNull();
		} finally {
			await vault.cleanup();
		}
	});

	it("reports malformed same-file and cross-file block references as invalid fragments", () => {
		const documents = [
			{ path: "notes/Source.md", content: "# Source\nText ^bad id\n" },
			{
				path: "notes/Target.md",
				content: "# Target\nText ^also-bad!\nBlock ^valid\n",
			},
		];

		expect(
			resolveDemoWikiReference("notes/Source.md", "#^bad id", documents),
		).toMatchObject({
			status: "invalidFragment",
			targetPath: "notes/Source.md",
		});
		expect(
			resolveDemoWikiReference(
				"notes/Source.md",
				"Target#^also-bad!",
				documents,
			),
		).toMatchObject({
			status: "invalidFragment",
			targetPath: "notes/Target.md",
		});
	});

	it("resolves Unicode block IDs in the browser demo", () => {
		const documents = [
			{ path: "notes/Source.md", content: "[[Target#^验收块]]\n" },
			{
				path: "notes/Target.md",
				content: "# Target\n可精确定位到本段。 ^验收块\n",
			},
		];

		expect(
			resolveDemoWikiReference("notes/Source.md", "Target#^验收块", documents),
		).toMatchObject({
			status: "resolved",
			targetPath: "notes/Target.md",
			fragment: { kind: "block", id: "验收块" },
		});
	});

	it("keeps source-relative Markdown links inside the Vault", () => {
		const documents = [
			{ path: "Target.md", content: "# Root target\n" },
			{ path: "notes/Target.md", content: "# Nearby target\n" },
		];

		expect(
			resolveDemoWikiReference(
				"notes/Source.md",
				"../../Target.md",
				documents,
				"markdown",
			),
		).toMatchObject({ status: "missing" });
	});

	it("classifies LinkElement destinations before choosing local Host navigation", () => {
		expect(isVaultLocalMarkdownLink("Target.md#Overview")).toBe(true);
		expect(isVaultLocalMarkdownLink("./Target.md#^block-id")).toBe(true);
		expect(isVaultLocalMarkdownLink("#Current heading")).toBe(true);
		expect(isVaultLocalMarkdownLink("https://example.com/Target.md")).toBe(
			false,
		);
		expect(isVaultLocalMarkdownLink("mailto:author@example.com")).toBe(false);
	});

	it("only reports zero writes when external repair details confirm it", () => {
		const preflight = Object.assign(new Error("source changed"), {
			details: { code: "sourceChanged", rollback: "not-needed" },
		});
		const rolledBack = Object.assign(new Error("write failed"), {
			details: { code: "writeFailed", rollback: "completed" },
		});
		const manualRecovery = Object.assign(new Error("write failed"), {
			details: { code: "writeFailed", rollback: "manual-recovery-required" },
		});

		expect(externalRenameRepairHadZeroWrites(preflight)).toBe(true);
		expect(externalRenameRepairHadZeroWrites(rolledBack)).toBe(false);
		expect(externalRenameRepairHadZeroWrites(manualRecovery)).toBe(false);
		expect(externalRenameRepairHadZeroWrites(new Error("unknown"))).toBe(false);
	});

	it("only offers external rename repair when a source needs rewriting", () => {
		expect(externalRenameRepairNeeded({ affectedSources: [] })).toBe(false);
		expect(
			externalRenameRepairNeeded({
				affectedSources: ["notes/Source.md"],
			}),
		).toBe(true);
	});
});

describe("Wiki rename target classification", () => {
	it("recognizes every file type supported as a Wiki target", () => {
		for (const path of [
			"/vault/notes/Source.md",
			"/vault/notes/Source.MDX",
			"/vault/notes/Source.markdown",
			"/vault/assets/paper.PDF",
			"/vault/assets/figure.png",
			"/vault/assets/figure.JPEG",
			"/vault/assets/figure.gif",
			"/vault/assets/figure.webp",
			"/vault/assets/figure.bmp",
			"/vault/assets/figure.svg",
			"/vault/assets/figure.avif",
			"/vault/assets/figure.ico",
		]) {
			expect(isWikiTargetPath(path), path).toBe(true);
		}
		expect(isWikiTargetPath("/vault/source/agentero-cite.json")).toBe(false);
	});

	it("handles Wiki targets, mixed events, and directory-like paths", () => {
		expect(renameMayAffectWikiTargets(["/vault/notes/Source.md"])).toBe(true);
		expect(
			renameMayAffectWikiTargets([
				"/vault/source/agentero-cite.json",
				"/vault/assets/paper.pdf",
			]),
		).toBe(true);
		expect(renameMayAffectWikiTargets(["/vault/notes/topic"])).toBe(true);
		expect(renameMayAffectWikiTargets(["C:\\vault\\notes\\topic"])).toBe(true);
		expect(renameMayAffectWikiTargets([])).toBe(true);
	});

	it("skips Wiki handling for explicit non-target file extensions", () => {
		expect(
			renameMayAffectWikiTargets([
				"/vault/source/agentero-cite.json.tmp",
				"/vault/source/agentero-cite.json",
				"C:\\vault\\source\\references.bib",
			]),
		).toBe(false);
	});
});

describe("wikilink preview rewrite", () => {
	it("rewrites real links to agentero hrefs without touching code", async () => {
		const vault = await createTestVault({
			"notes/Source.md": "See [[notes/Target#Intro|Target Note]].",
			"notes/Target.md": "# Target",
		});

		try {
			const files = await vault.listMarkdownFiles();
			const rewritten = rewriteWikilinksForPreview(
				[
					"See [[notes/Target#Intro|Target Note]] and `[[ignored-inline]]`.",
					"```",
					"[[ignored-fence]]",
					"```",
				].join("\n"),
				files,
			);

			expect(rewritten).toContain("[Target Note](agentero-wiki:");
			expect(rewritten).toContain("`[[ignored-inline]]`");
			expect(rewritten).toContain("[[ignored-fence]]");

			const href = rewritten.match(/\((agentero-wiki:[^)]+)\)/)?.[1];
			expect(href?.startsWith(WIKI_HREF_PREFIX)).toBe(true);
			expect(parseWikiHref(href ?? "")).toEqual({
				targetRaw: "notes/Target",
				path: "notes/Target.md",
				status: "resolved",
				fragment: { kind: "heading", path: ["Intro"] },
			});
		} finally {
			await vault.cleanup();
		}
	});
});

describe("wikilink click destination", () => {
	it("opens the target file without a stale heading when the fragment is missing", () => {
		expect(
			wikiNavigationDestination({
				targetRaw: "02-链接目标",
				path: "notes/02-链接目标.md",
				status: "invalidFragment",
				fragment: { kind: "heading", path: ["已删除标题"] },
			}),
		).toEqual({
			path: "notes/02-链接目标.md",
			warning: "invalidFragment",
		});
	});

	it("keeps a valid fragment for precise navigation", () => {
		const fragment = { kind: "heading" as const, path: ["现有标题"] };
		expect(
			wikiNavigationDestination({
				targetRaw: "02-链接目标",
				path: "notes/02-链接目标.md",
				status: "resolved",
				fragment,
			}),
		).toEqual({
			path: "notes/02-链接目标.md",
			fragment,
		});
	});
});
