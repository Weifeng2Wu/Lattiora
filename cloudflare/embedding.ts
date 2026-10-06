import { z } from "zod";
import { isSecretMask } from "../src/lib/cloud/settings-secrets";
import { HttpError, json, readJson } from "./http";
import { providerJson, serviceEndpoint } from "./providers";
import { readSettingsSecret } from "./settings";
import type { Env } from "./worker";

const schema = z
	.object({
		baseUrl: z.string().min(1).max(2048),
		model: z.string().min(1).max(200),
		apiKey: z.string().max(16000).optional(),
		input: z.array(z.string().min(1).max(16000)).min(1).max(64),
	})
	.strict();
export type EmbeddingInput = z.infer<typeof schema>;
export async function embed(
	input: EmbeddingInput,
	env: Env,
	signal: AbortSignal,
): Promise<number[][]> {
	const key =
		input.apiKey && !isSecretMask(input.apiKey)
			? input.apiKey
			: await readSettingsSecret(env, "embedding.apiKey");
	if (!key) throw new HttpError(409, "aiNotConfigured");
	const data = (await providerJson(
		serviceEndpoint(input.baseUrl, "/embeddings"),
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${key}`,
			},
			body: JSON.stringify({
				model: input.model,
				input: input.input,
				encoding_format: "float",
			}),
		},
		signal,
	)) as { data?: Array<{ index?: number; embedding?: number[] }> };
	if (!Array.isArray(data?.data) || data.data.length !== input.input.length)
		throw new HttpError(502, "invalidProviderResponse");
	const vectors: number[][] = [];
	let dimension = 0;
	for (const row of data.data) {
		if (
			!Number.isInteger(row.index) ||
			row.index! < 0 ||
			row.index! >= input.input.length ||
			vectors[row.index!] ||
			!Array.isArray(row.embedding) ||
			!row.embedding.length ||
			row.embedding.length > 32768 ||
			!row.embedding.every(
				(n) => typeof n === "number" && Number.isFinite(n),
			) ||
			(dimension && row.embedding.length !== dimension)
		)
			throw new HttpError(502, "invalidProviderResponse");
		dimension = row.embedding.length;
		vectors[row.index!] = row.embedding;
	}
	return vectors;
}
export async function embeddingRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	if (new URL(request.url).pathname !== "/api/embedding") return null;
	if (request.method !== "POST") throw new HttpError(405, "methodNotAllowed");
	const parsed = schema.safeParse(await readJson(request, 1100000));
	if (!parsed.success) throw new HttpError(400, "invalidRequest");
	const start = Date.now();
	const vectors = await embed(parsed.data, env, request.signal);
	return json({
		vectors,
		dim: vectors[0].length,
		latencyMs: Date.now() - start,
	});
}
