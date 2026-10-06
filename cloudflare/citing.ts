import { z } from "zod";
import { isSecretMask } from "../src/lib/cloud/settings-secrets";
import { HttpError, json, readJson } from "./http";
import { providerJson, serviceEndpoint } from "./providers";
import { readSettingsSecret } from "./settings";
import type { Env } from "./worker";

const paperSchema = z.object({
	paperId: z.string().min(1).max(128),
	title: z.string().max(20000).nullish(),
	publicationDate: z.string().max(32).nullish(),
	year: z.number().int().nullish(),
	externalIds: z
		.object({
			DOI: z.string().max(600).nullish(),
			ArXiv: z.string().max(128).nullish(),
		})
		.nullish(),
	citationCount: z.number().int().nonnegative().nullish(),
	openAccessPdf: z.object({ url: z.string().max(4096) }).nullish(),
	embedding: z
		.object({ vector: z.array(z.number().finite()).min(1).max(8192) })
		.nullish(),
});
const config = z.object({
	baseUrl: z.string().min(1).max(2048),
	apiKey: z.string().max(16000).optional(),
});
const schema = z.discriminatedUnion("operation", [
	config.extend({
		operation: z.literal("batch"),
		ids: z.array(z.string().min(1).max(600)).min(1).max(100),
	}),
	config.extend({
		operation: z.literal("citations"),
		id: z.string().regex(/^[a-f0-9]{40}$/i),
		offset: z.number().int().min(0).max(2000),
	}),
	config.extend({ operation: z.literal("probe") }),
]);
export async function citingRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	if (new URL(request.url).pathname !== "/api/citing") return null;
	if (request.method !== "POST") throw new HttpError(405, "methodNotAllowed");
	const parsed = schema.safeParse(await readJson(request, 100000));
	if (!parsed.success) throw new HttpError(400, "invalidRequest");
	const input = parsed.data;
	const key =
		input.apiKey && !isSecretMask(input.apiKey)
			? input.apiKey
			: await readSettingsSecret(env, "scholar.apiKey");
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (key) headers["x-api-key"] = key;
	const start = Date.now();
	let url: URL,
		init: RequestInit = { headers };
	if (input.operation === "citations") {
		url = serviceEndpoint(input.baseUrl, `/paper/${input.id}/citations`);
		url.searchParams.set(
			"fields",
			"title,year,publicationDate,externalIds,citationCount,openAccessPdf",
		);
		url.searchParams.set("limit", "1000");
		url.searchParams.set("offset", String(input.offset));
	} else {
		url = serviceEndpoint(input.baseUrl, "/paper/batch");
		url.searchParams.set(
			"fields",
			input.operation === "probe"
				? "paperId"
				: "paperId,citationCount,embedding.specter_v2",
		);
		init = {
			headers,
			method: "POST",
			body: JSON.stringify({
				ids: input.operation === "probe" ? ["ARXIV:1706.03762"] : input.ids,
			}),
		};
	}
	const data = await providerJson(url, init, request.signal, 30000);
	const validated =
		input.operation === "citations"
			? z
					.object({
						data: z
							.array(z.object({ citingPaper: paperSchema.nullish() }))
							.max(1000),
						next: z.number().int().nonnegative().nullish(),
					})
					.safeParse(data)
			: z
					.array(paperSchema.nullable())
					.length(input.operation === "probe" ? 1 : input.ids.length)
					.safeParse(data);
	if (!validated.success) throw new HttpError(502, "invalidProviderResponse");
	if (
		input.operation === "probe" &&
		(!Array.isArray(validated.data) || !validated.data[0]?.paperId)
	)
		throw new HttpError(502, "invalidProviderResponse");
	return json(
		input.operation === "probe"
			? { ok: true, latencyMs: Date.now() - start }
			: validated.data,
	);
}
