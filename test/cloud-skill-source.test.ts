import { expect, it } from "vitest";
import {
	parseSkillMetadata,
	parseSkillSource,
} from "../src/lib/cloud/skill-source";

it("parses original GitHub, npx and skills.sh inputs without treating paper ids as skills", () => {
	for (const input of [
		"https://github.com/owner/repo.git",
		"github:owner/repo",
		"npx skills add owner/repo",
		"npx skills add 'https://github.com/owner/repo' --skill '*' -y",
	])
		expect(parseSkillSource(input)).toMatchObject({
			owner: "owner",
			repo: "repo",
			ref: null,
			path: "",
			names: [],
		});
	expect(
		parseSkillSource(
			"https://github.com/openai/skills/tree/main/skills/.experimental/create-plan",
		),
	).toMatchObject({ ref: "main", path: "skills/.experimental/create-plan" });
	expect(
		parseSkillSource("https://skills.sh/owner/repo/frontend-design"),
	).toMatchObject({ names: ["frontend-design"] });
	expect(
		parseSkillSource("npx skills add owner/repo#release --skill first second"),
	).toMatchObject({ ref: "release", names: ["first", "second"] });
	for (const paper of [
		"10.1234/abc",
		"owner/repo",
		"https://arxiv.org/abs/1706.03762",
		"https://github.com.evil.test/owner/repo",
	])
		expect(parseSkillSource(paper)).toBeNull();
});
it("rejects invalid command syntax and escaping source paths", () => {
	for (const input of [
		"npx skills add owner/repo && curl attacker",
		"npx skills add 'owner/repo",
		"npx skills add owner/repo --skill",
		"https://user:password@github.com/owner/repo",
		"https://github.com/owner/repo/tree/main/a%2F..%2Fb",
	])
		expect(() => parseSkillSource(input)).toThrow("invalidSkillSource");
});
it("preserves hashes inside quoted descriptions and rejects normalized dot segments", () => {
	expect(
		parseSkillMetadata(
			'---\nname: test\ndescription: "Use # headings" # comment\n---\n',
		).description,
	).toBe("Use # headings");
	expect(() =>
		parseSkillSource("https://github.com/owner/repo/tree/main/../other"),
	).toThrow("invalidSkillSource");
});
it("reads quoted and folded metadata, truncating long descriptions by Unicode characters", () => {
	expect(
		parseSkillMetadata(
			"---\r\nname: 'paper-reader'\r\ndescription: >-\r\n  Read the paper\r\n  with evidence.\r\n---\r\nBody",
		),
	).toEqual({
		name: "paper-reader",
		description: "Read the paper with evidence.",
	});
	expect(
		parseSkillMetadata(
			`---\nname: test\ndescription: "${"学".repeat(1100)}"\n---\n`,
		).description,
	).toHaveLength(1024);
	expect(() =>
		parseSkillMetadata("---\nname: ../escape\ndescription: unsafe\n---\n"),
	).toThrow("invalidSkillMetadata");
});
