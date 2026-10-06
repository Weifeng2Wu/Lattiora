import { loadSettings } from "@/lib/settings";
import { cloudLock, localTransaction } from "./db";
import { editedFile, filesChanged, listLocalFiles } from "./files";
import { cloudFetch } from "./sync";

const ROOT = ".agentero/recommend/";
export const embeddingConfigKey = () => {
	const e = loadSettings().embedding;
	return JSON.stringify([e.baseUrl.trim().replace(/\/+$/, ""), e.model.trim()]);
};
export async function hashText(value: string) {
	return [
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
		),
	]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
}
export function validEmbeddingVector(value: unknown): value is number[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.length <= 8192 &&
		value.every((n) => typeof n === "number" && Number.isFinite(n))
	);
}
export async function cachedEmbeddings(
	texts: string[],
	config: string,
	signal?: AbortSignal,
	progress?: (value: number) => void,
): Promise<number[][]> {
	if (embeddingConfigKey() !== config)
		throw new Error("recommend.config_changed");
	const modelHash = await hashText(config);
	const hashes = await Promise.all(texts.map(hashText));
	const prefix = `${ROOT}vectors/${modelHash}/`;
	const local = new Map(
		(await listLocalFiles())
			.filter((file) => !file.deleted && file.path.startsWith(prefix))
			.map((file) => [file.path, file]),
	);
	const byHash = new Map<string, number[]>();
	let vectorBytes = 0;
	const remember = (id: string, vector: number[]) => {
		if (!byHash.has(id)) vectorBytes += vector.length * 8;
		if (vectorBytes > 128 * 1024 * 1024) throw new Error("recommend.too_large");
		byHash.set(id, vector);
	};
	const missing = new Map<string, string>();

	for (let i = 0; i < hashes.length; i++) {
		const id = hashes[i];
		if (byHash.has(id) || missing.has(id)) continue;
		const file = local.get(`${prefix}${id}.json`);
		let cached: unknown = null;
		try {
			if (file?.data) cached = JSON.parse(await file.data.text());
		} catch {
			/* Rebuild corrupt derived vectors. */
		}
		if (validEmbeddingVector(cached)) remember(id, cached);
		else missing.set(id, texts[i]);
	}
	const entries = [...missing];
	const e = loadSettings().embedding;
	for (let offset = 0; offset < entries.length; offset += 64) {
		signal?.throwIfAborted();
		const batch = entries.slice(offset, offset + 64);
		const response = await cloudFetch("/api/embedding", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				baseUrl: e.baseUrl,
				model: e.model,
				apiKey: e.apiKey,
				input: batch.map(([, text]) => text),
			}),
			signal: signal ?? AbortSignal.timeout(120000),
		});
		const data = (await response.json()) as { vectors: number[][] };
		if (
			!Array.isArray(data.vectors) ||
			data.vectors.length !== batch.length ||
			!data.vectors.every(validEmbeddingVector)
		)
			throw new Error("invalidProviderResponse");
		const changed: string[] = [];
		await cloudLock("files", () =>
			localTransaction((files) => {
				for (let i = 0; i < batch.length; i++) {
					const id = batch[i][0],
						vector = data.vectors[i],
						path = `${prefix}${id}.json`;
					remember(id, vector);
					if (
						files.get(path)?.localId === local.get(path)?.localId ||
						!files.get(path) ||
						files.get(path)?.deleted
					) {
						files.set(
							path,
							editedFile(
								path,
								new Blob([JSON.stringify(vector)], {
									type: "application/json",
								}),
								files.get(path),
							),
						);
						changed.push(path);
					}
				}
			}),
		);
		if (changed.length) filesChanged(changed);
		progress?.(
			20 +
				75 * Math.min(1, (offset + batch.length) / Math.max(1, entries.length)),
		);
	}
	const result = hashes.map((id) => byHash.get(id));
	if (result.some((v) => !v)) throw new Error("invalidProviderResponse");
	return result as number[][];
}

export async function embeddingVectorPath(config: string, text: string) {
	return `${ROOT}vectors/${await hashText(config)}/${await hashText(text)}.json`;
}
