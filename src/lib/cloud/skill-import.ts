import type { SkillDiscovery, SkillImportResult } from "@/lib/core/bindings";
import { cloudLock, localTransaction } from "./db";
import { editedFile, filesChanged } from "./files";
import {
	parseSkillMetadata,
	validSkillName,
	validSkillPath,
} from "./skill-source";
import { listSkills } from "./skills";
import { cloudFetch } from "./sync";

type Discovery = {
	owner: string;
	repo: string;
	commit: string;
	source: string;
	uploaded?: Map<string, Blob>;
	candidates: Array<{
		name: string;
		description: string;
		relativePath: string;
		files: string[];
	}>;
};
const discoveries = new Map<string, Discovery>();
async function post(
	path: string,
	body: Record<string, unknown>,
	signal?: AbortSignal,
) {
	const { getSettings } = await import("@/lib/settings/react-store");
	const settings = getSettings();
	return cloudFetch(`/api/skills/${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			...body,
			mirror: settings.githubMirrorEnabled
				? settings.githubMirrorBaseUrl
				: undefined,
		}),
		signal,
	});
}
export function discardCloudSkillDiscovery(id: string) {
	discoveries.delete(id);
}
export async function discoverCloudSkills(
	source: string,
	signal?: AbortSignal,
): Promise<SkillDiscovery> {
	const value = (await (
		await post("discover", { source }, signal)
	).json()) as Discovery;
	signal?.throwIfAborted();
	return rememberDiscovery(value);
}
async function rememberDiscovery(value: Discovery): Promise<SkillDiscovery> {
	const source = value.source;
	const installed = new Set((await listSkills()).map((skill) => skill.id));
	const discoveryId = crypto.randomUUID();
	if (discoveries.size >= 32) throw new Error("skillSourceTooLarge");
	discoveries.set(discoveryId, value);
	return {
		discoveryId,
		source,
		candidates: value.candidates.map((candidate) => ({
			name: candidate.name,
			description: candidate.description,
			relativePath: candidate.relativePath,
			source,
			alreadyInstalled: installed.has(candidate.name),
		})),
	};
}
/** Download first, then commit every selected skill in one IDB transaction. */
export async function installCloudSkills(
	id: string,
	selectedNames: string[],
	signal?: AbortSignal,
	progress?: (n: number) => void,
): Promise<SkillImportResult[]> {
	const discovery = discoveries.get(id);
	if (!discovery) throw new Error("skillDiscoveryExpired");
	const selected = [...new Set(selectedNames)].map((name) => {
		const candidate = discovery.candidates.find((item) => item.name === name);
		if (!candidate || !validSkillName(name))
			throw new Error("invalidSkillSource");
		return candidate;
	});
	const installed = new Set((await listSkills()).map((skill) => skill.id));
	const downloads = new Map<string, Map<string, Blob>>();
	const total = selected
		.filter((item) => !installed.has(item.name))
		.reduce((sum, item) => sum + item.files.length, 0);
	let completed = 0;
	let size = 0;
	for (const candidate of selected) {
		if (installed.has(candidate.name)) continue;
		const files = new Map<string, Blob>();
		if (candidate.files.length > 200) throw new Error("skillSourceTooLarge");
		for (const path of candidate.files) {
			signal?.throwIfAborted();
			const prefix = candidate.relativePath ? `${candidate.relativePath}/` : "";
			const relative = path.slice(prefix.length);
			if (!path.startsWith(prefix) || !validSkillPath(relative))
				throw new Error("invalidSkillSource");
			const blob = discovery.uploaded
				? discovery.uploaded.get(path)
				: await (
						await post(
							"file",
							{
								owner: discovery.owner,
								repo: discovery.repo,
								commit: discovery.commit,
								path,
							},
							signal,
						)
					).blob();
			if (!blob) throw new Error("invalidSkillSource");
			size += blob.size;
			if (blob.size > 2 * 1024 * 1024 || size > 32 * 1024 * 1024)
				throw new Error("skillSourceTooLarge");
			files.set(relative, blob);
			progress?.((++completed / Math.max(total, 1)) * 90);
		}
		if (!files.has("SKILL.md")) throw new Error("invalidSkillMetadata");
		files.set(
			"agentero-skill.json",
			new Blob(
				[
					JSON.stringify({
						source: discovery.source,
						commit: discovery.commit,
						relativePath: candidate.relativePath,
						installedAt: new Date().toISOString(),
					}),
				],
				{ type: "application/json" },
			),
		);
		downloads.set(candidate.name, files);
	}
	const changed: string[] = [];
	const result = await cloudLock("files", () =>
		localTransaction((files) => {
			signal?.throwIfAborted();
			return selected.map((candidate) => {
				const root = `.agents/skills/${candidate.name}`;
				const exists =
					installed.has(candidate.name) ||
					[...files.values()].some(
						(file) =>
							!file.deleted &&
							(file.path === root || file.path.startsWith(`${root}/`)),
					);
				if (!exists)
					for (const [relative, blob] of downloads.get(candidate.name) ?? []) {
						const path = `${root}/${relative}`;
						files.set(path, editedFile(path, blob, files.get(path)));
						changed.push(path);
					}
				return {
					name: candidate.name,
					description: candidate.description,
					path: `/cloud/${root}`,
					source: discovery.source,
					skipped: exists,
				};
			});
		}),
	);
	if (changed.length) filesChanged(changed);
	discoveries.delete(id);
	progress?.(100);
	return result;
}

/** User files stay in the browser until confirmed and synchronized as workspace files. */
export async function discoverUploadedSkills(
	file: File,
): Promise<SkillDiscovery> {
	if (file.size > 16 * 1024 * 1024) throw new Error("skillSourceTooLarge");
	const uploaded = new Map<string, Blob>();
	if (file.name.toLowerCase().endsWith(".zip")) {
		const { unzipSync } = await import("fflate");
		let size = 0;
		const seen = new Set<string>();
		const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
			filter: (entry) => {
				const path = entry.name.endsWith("/")
					? entry.name.slice(0, -1)
					: entry.name;
				if (!validSkillPath(path) || seen.has(entry.name))
					throw new Error("invalidSkillSource");
				seen.add(entry.name);
				size += entry.originalSize;
				if (
					seen.size > 1000 ||
					entry.originalSize > 2 * 1024 * 1024 ||
					size > 16 * 1024 * 1024
				)
					throw new Error("skillSourceTooLarge");
				return !entry.name.endsWith("/");
			},
		});
		for (const [path, bytes] of Object.entries(entries))
			uploaded.set(path, new Blob([new Uint8Array(bytes)]));
	} else if (file.name.toLowerCase() === "skill.md")
		uploaded.set("SKILL.md", file);
	else throw new Error("invalidSkillSource");
	const candidates: Discovery["candidates"] = [];
	const names = new Set<string>();
	for (const [path, blob] of uploaded) {
		if (path.split("/").at(-1) !== "SKILL.md") continue;
		if (blob.size > 128 * 1024) throw new Error("skillSourceTooLarge");
		const metadata = parseSkillMetadata(await blob.text());
		if (names.has(metadata.name)) throw new Error("skillSourceAmbiguous");
		names.add(metadata.name);
		const directory = path.slice(0, -"SKILL.md".length);
		const files = [...uploaded.keys()].filter((file) =>
			file.startsWith(directory),
		);
		if (files.length > 200 || candidates.length >= 40)
			throw new Error("skillSourceTooLarge");
		candidates.push({
			...metadata,
			relativePath: directory.replace(/\/$/, ""),
			files,
		});
	}
	if (!candidates.length) throw new Error("invalidSkillMetadata");
	return rememberDiscovery({
		owner: "",
		repo: "",
		commit: "",
		source: `upload:${file.name}`,
		uploaded,
		candidates,
	});
}
