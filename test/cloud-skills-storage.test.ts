import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/lib/cloud/skills", () => ({ listSkills: async () => [] }));
const source = {
	owner: "owner",
	repo: "repo",
	commit: "a".repeat(40),
	source: "github:owner/repo",
	candidates: [
		{
			name: "test",
			description: "Test",
			relativePath: "skills/test",
			files: ["skills/test/SKILL.md", "skills/test/assets/a.bin"],
		},
	],
};
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: { request: (_name: string, fn: () => unknown) => fn() },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) =>
			url.endsWith("discover")
				? Response.json(source)
				: new Response(new Uint8Array([0, 1, 255])),
		),
	);
});
afterEach(() => vi.unstubAllGlobals());
it("atomically installs binary resources and provenance as syncable files, preserving existing directories", async () => {
	const importer = await import("../src/lib/cloud/skill-import");
	const files = await import("../src/lib/cloud/files");
	const draft = await importer.discoverCloudSkills(source.source);
	const result = await importer.installCloudSkills(draft.discoveryId, ["test"]);
	expect(result[0].skipped).toBe(false);
	const records = await files.listLocalFiles();
	expect(records).toHaveLength(3);
	expect(records.every((file) => file.dirty && !file.deleted)).toBe(true);
	expect(
		new Uint8Array(
			await (
				await files.readLocalFile(".agents/skills/test/assets/a.bin")
			).arrayBuffer(),
		),
	).toEqual(new Uint8Array([0, 1, 255]));
	expect(
		JSON.parse(
			await (
				await files.readLocalFile(".agents/skills/test/agentero-skill.json")
			).text(),
		).commit,
	).toBe(source.commit);
	const again = await importer.discoverCloudSkills(source.source);
	expect(
		(await importer.installCloudSkills(again.discoveryId, ["test"]))[0].skipped,
	).toBe(true);
	expect((await files.listLocalFiles()).map((file) => file.localId)).toEqual(
		records.map((file) => file.localId),
	);
});
it("download failure or cancellation never commits a partial Skill and discovery can be discarded", async () => {
	const importer = await import("../src/lib/cloud/skill-import");
	const files = await import("../src/lib/cloud/files");
	const draft = await importer.discoverCloudSkills(source.source);
	const fetcher = vi.mocked(fetch);
	fetcher
		.mockResolvedValueOnce(new Response("header"))
		.mockRejectedValueOnce(new Error("offline"));
	await expect(
		importer.installCloudSkills(draft.discoveryId, ["test"]),
	).rejects.toThrow("offline");
	expect(await files.listLocalFiles()).toEqual([]);
	const controller = new AbortController();
	await expect(
		importer.installCloudSkills(
			draft.discoveryId,
			["test"],
			controller.signal,
			() => controller.abort(),
		),
	).rejects.toThrow();
	expect(await files.listLocalFiles()).toEqual([]);
	importer.discardCloudSkillDiscovery(draft.discoveryId);
	await expect(
		importer.installCloudSkills(draft.discoveryId, ["test"]),
	).rejects.toThrow("skillDiscoveryExpired");
});

it("stages uploaded ZIP Skills offline and installs only the selected directory without HTTP", async () => {
	const { zipSync } = await import("fflate");
	const importer = await import("../src/lib/cloud/skill-import");
	const files = await import("../src/lib/cloud/files");
	const encode = (name: string) =>
		new TextEncoder().encode(
			`---\nname: ${name}\ndescription: User skill\n---\nRead files.`,
		);
	const bytes = zipSync({
		"bundle/one/SKILL.md": encode("one"),
		"bundle/one/assets/image.bin": new Uint8Array([0, 255, 2]),
		"bundle/two/SKILL.md": encode("two"),
	});
	const file = new File([new Uint8Array(bytes)], "my-skills.zip");
	vi.mocked(fetch).mockRejectedValue(new Error("offline"));
	const draft = await importer.discoverUploadedSkills(file);
	expect(draft.candidates.map((candidate) => candidate.name)).toEqual([
		"one",
		"two",
	]);
	expect(await files.listLocalFiles()).toEqual([]);
	await importer.installCloudSkills(draft.discoveryId, ["one"]);
	expect(fetch).not.toHaveBeenCalled();
	const records = await files.listLocalFiles();
	expect(records).toHaveLength(3);
	expect(
		records.every((file) => file.path.startsWith(".agents/skills/one/")),
	).toBe(true);
	expect(
		new Uint8Array(
			await (
				await files.readLocalFile(".agents/skills/one/assets/image.bin")
			).arrayBuffer(),
		),
	).toEqual(new Uint8Array([0, 255, 2]));
});
it("rejects unsafe ZIP paths and duplicate Skill identities without changing the workspace", async () => {
	const { zipSync } = await import("fflate");
	const importer = await import("../src/lib/cloud/skill-import");
	const content = new TextEncoder().encode(
		"---\nname: test\ndescription: User skill\n---\n",
	);
	for (const entries of [
		{ "../SKILL.md": content },
		{ "a/SKILL.md": content, "b/SKILL.md": content },
	]) {
		const file = new File([new Uint8Array(zipSync(entries))], "unsafe.zip");
		await expect(importer.discoverUploadedSkills(file)).rejects.toThrow();
	}
	const files = await import("../src/lib/cloud/files");
	expect(await files.listLocalFiles()).toEqual([]);
	const single = await importer.discoverUploadedSkills(
		new File([content], "SKILL.md"),
	);
	expect(single.candidates[0].name).toBe("test");
	importer.discardCloudSkillDiscovery(single.discoveryId);
	expect(await files.listLocalFiles()).toEqual([]);
});
