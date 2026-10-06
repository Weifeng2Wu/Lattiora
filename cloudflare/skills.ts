import { z } from "zod";
import {
	GITHUB_MIRROR_PRESETS,
	mirroredGithubDownload,
} from "../src/lib/cloud/github-mirror";
import {
	parseSkillMetadata,
	parseSkillSource,
	validSkillPath,
} from "../src/lib/cloud/skill-source";
import { HttpError, json, readBytes, readJson } from "./http";

const repoSchema = z.object({
	owner: z.string().regex(/^[a-z\d][a-z\d-]{0,38}$/i),
	repo: z
		.string()
		.regex(/^[\w.-]{1,100}$/)
		.refine((v) => v !== "." && v !== ".."),
	commit: z.string().regex(/^[a-f0-9]{40}$/),
	path: z.string().refine(validSkillPath),
});
const treeSchema = z.object({
	truncated: z.boolean(),
	tree: z.array(
		z.object({
			path: z.string(),
			mode: z.string(),
			type: z.string(),
			size: z.number().optional(),
		}),
	),
});
const encodedPath = (path: string) =>
	path.split("/").map(encodeURIComponent).join("/");
async function github(
	url: string,
	limit: number,
	signal: AbortSignal,
	mirror?: string,
): Promise<Uint8Array> {
	const alternate = mirroredGithubDownload(url, mirror);
	const candidates = alternate === url ? [url] : [url, alternate];
	for (const [index, endpoint] of candidates.entries()) {
		let response: Response;
		try {
			response = await fetch(endpoint, {
				signal: AbortSignal.any([
					signal,
					AbortSignal.timeout(candidates.length > 1 ? 12000 : 25000),
				]),
				redirect: "manual",
				headers: {
					"user-agent": "Lattiora",
					accept: "application/vnd.github+json",
				},
			});
		} catch {
			if (index + 1 < candidates.length && !signal.aborted) continue;
			throw new HttpError(502, "skillSourceUnavailable");
		}
		if (response.ok) return readBytes(response, limit);
		await response.body?.cancel();
		if (index + 1 === candidates.length)
			throw new HttpError(
				response.status === 403 || response.status === 429 ? 429 : 502,
				"skillSourceUnavailable",
			);
	}
	throw new HttpError(502, "skillSourceUnavailable");
}
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Public GitHub content only. No caller URL, token, redirect or executable crosses this boundary. */
export async function skillRoutes(request: Request): Promise<Response | null> {
	const route = new URL(request.url).pathname;
	if (
		request.method !== "POST" ||
		!["/api/skills/discover", "/api/skills/file", "/api/skills/probe"].includes(
			route,
		)
	)
		return null;
	const body = await readJson(request, 8192);
	const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
	const options = z
		.object({ mirror: z.enum(GITHUB_MIRROR_PRESETS).optional() })
		.safeParse(body);
	if (!options.success) throw new HttpError(400, "invalidEndpoint");
	const mirror = options.data.mirror;
	const download = (url: string, limit: number, signal: AbortSignal) =>
		github(url, limit, signal, mirror);
	if (route === "/api/skills/probe") {
		await github(
			mirroredGithubDownload(
				"https://raw.githubusercontent.com/poco-ai/Agentero/b6320ce5/README.md",
				mirror,
			),
			128 * 1024,
			signal,
		);
		return json({ ok: true });
	}
	try {
		if (route === "/api/skills/file") {
			const parsed = repoSchema.safeParse(body);
			if (!parsed.success) throw new HttpError(400, "invalidSkillSource");
			const { owner, repo, commit, path } = parsed.data;
			const bytes = await download(
				`https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${encodedPath(path)}`,
				2 * 1024 * 1024,
				signal,
			);
			return new Response(bytes, {
				headers: {
					"content-type": "application/octet-stream",
					"cache-control": "no-store",
				},
			});
		}
		const input = z.object({ source: z.string().max(4096) }).safeParse(body);
		if (!input.success) throw new HttpError(400, "invalidSkillSource");
		let source: ReturnType<typeof parseSkillSource>;
		try {
			source = parseSkillSource(input.data.source);
		} catch {
			throw new HttpError(400, "invalidSkillSource");
		}
		if (!source) throw new HttpError(400, "invalidSkillSource");
		const base = `https://api.github.com/repos/${source.owner}/${source.repo}`;
		const revisions = JSON.parse(
			decode(
				await download(
					`${base}/commits?per_page=1${source.ref ? `&sha=${encodeURIComponent(source.ref)}` : ""}`,
					1024 * 1024,
					signal,
				),
			),
		) as { sha?: string }[];
		const revision = revisions[0];
		if (!revision?.sha || !/^[a-f0-9]{40}$/.test(revision.sha))
			throw new HttpError(502, "skillSourceUnavailable");
		const commit = revision.sha;
		const result = treeSchema.parse(
			JSON.parse(
				decode(
					await download(
						`${base}/git/trees/${commit}?recursive=1`,
						4 * 1024 * 1024,
						signal,
					),
				),
			),
		);
		if (result.truncated) throw new HttpError(413, "skillSourceTooLarge");
		const roots = result.tree.filter(
			(entry) =>
				entry.type === "blob" &&
				/^100(644|755)$/.test(entry.mode) &&
				entry.path.split("/").at(-1) === "SKILL.md" &&
				(!source.path || entry.path.startsWith(`${source.path}/`)),
		);
		// Keep each request below the Workers Free subrequest budget. Use a subtree URL for larger repositories.
		if (roots.length > 40) throw new HttpError(413, "skillSourceTooLarge");
		const candidates = [];
		const names = new Set<string>();
		for (const entry of roots) {
			if (!validSkillPath(entry.path)) continue;
			const text = decode(
				await download(
					`https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commit}/${encodedPath(entry.path)}`,
					128 * 1024,
					signal,
				),
			);
			let metadata: ReturnType<typeof parseSkillMetadata>;
			try {
				metadata = parseSkillMetadata(text);
			} catch {
				continue;
			}
			if (source.names.length && !source.names.includes(metadata.name))
				continue;
			if (names.has(metadata.name))
				throw new HttpError(409, "skillSourceAmbiguous");
			names.add(metadata.name);
			const directory = entry.path.slice(0, -"SKILL.md".length);
			const files = result.tree.filter(
				(file) => file.path.startsWith(directory) && file.type !== "tree",
			);
			// Never dereference symlinks or submodules; reject rather than silently omitting resources.
			if (
				files.some(
					(file) =>
						!validSkillPath(file.path) ||
						file.type !== "blob" ||
						!/^100(644|755)$/.test(file.mode),
				)
			)
				throw new HttpError(400, "skillSourceUnsafe");
			if (
				files.length > 200 ||
				files.some((file) => (file.size ?? 0) > 2 * 1024 * 1024) ||
				files.reduce((sum, file) => sum + (file.size ?? 0), 0) >
					16 * 1024 * 1024
			)
				throw new HttpError(413, "skillSourceTooLarge");
			candidates.push({
				...metadata,
				relativePath: directory.replace(/\/$/, ""),
				files: files.map((file) => file.path),
			});
		}
		return json({
			owner: source.owner,
			repo: source.repo,
			commit,
			source: input.data.source,
			candidates,
		});
	} catch (error) {
		if (error instanceof HttpError) {
			if (error.status === 413) throw new HttpError(413, "skillSourceTooLarge");
			throw error;
		}
		throw new HttpError(502, "skillSourceUnavailable");
	}
}
