import type { AgentSkill } from "@/lib/agent/api";
import bundledVaultInstructions from "../../../templates/vault/AGENTS.md?raw";
import { cloudRelative, listLocalFiles, readLocalFile } from "./files";
import { parseSkillMetadata } from "./skill-source";
import { installTemplateFiles } from "./template-install";

const loaders = import.meta.glob<string>(
	"../../../templates/vault/.agents/skills/**/*",
	{ query: "?raw", import: "default" },
);
const bundled = new Map(
	Object.entries(loaders).map(([path, loader]) => [
		path.split("templates/vault/")[1],
		loader,
	]),
);
const prefix = ".agents/skills/";
export async function vaultInstructions(): Promise<string> {
	const exists = (await listLocalFiles()).some(
		(file) => file.path === "AGENTS.md" && !file.deleted,
	);
	return exists
		? (await readLocalFile("AGENTS.md")).text()
		: bundledVaultInstructions;
}
function metadata(path: string, body: string): AgentSkill {
	const id = path.split("/")[2];
	try {
		return { id, ...parseSkillMetadata(body) };
	} catch {
		return { id, name: id, description: "" };
	}
}
export async function readSkillFile(path: string): Promise<string> {
	const rel = cloudRelative(path);
	if (!rel.startsWith(prefix)) throw new Error("invalidPath");
	const local = (await listLocalFiles()).find(
		(f) => f.path === rel && !f.deleted,
	);
	if (local) return (await readLocalFile(rel)).text();
	const loader = bundled.get(rel);
	if (!loader) throw new Error("notFound");
	return loader();
}
export async function listSkills(): Promise<AgentSkill[]> {
	const paths = new Set(
		[...bundled.keys()].filter((p) => p.endsWith("/SKILL.md")),
	);
	for (const f of await listLocalFiles())
		if (!f.deleted && /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(f.path))
			paths.add(f.path);
	return Promise.all(
		[...paths]
			.sort()
			.map(async (path) => metadata(path, await readSkillFile(path))),
	);
}
export async function skillInstructions(ids: string[]): Promise<string> {
	const available = await listSkills();
	return (
		await Promise.all(
			[...new Set(ids)].map(async (id) => {
				if (!available.some((s) => s.id === id))
					throw new Error("skillNotFound");
				const path = `${prefix}${id}/SKILL.md`;
				return `\n<selected_skill path="${path}">\n${await readSkillFile(path)}\n</selected_skill>`;
			}),
		)
	).join("\n");
}
const examples = import.meta.glob<string>(
	[
		"../../../templates/vault/notes/**/*.md",
		"../../../templates/vault/thesis/*.tex",
	],
	{ query: "?raw", import: "default" },
);
/** Install original examples and preserve user overrides during template upgrades. */
export async function installBundledSkills(): Promise<string[]> {
	const files = new Map<string, string>([
		["AGENTS.md", bundledVaultInstructions],
	]);
	for (const [path, loader] of bundled) files.set(path, await loader());
	for (const [path, loader] of Object.entries(examples))
		files.set(path.split("templates/vault/")[1], await loader());
	return installTemplateFiles(files);
}
