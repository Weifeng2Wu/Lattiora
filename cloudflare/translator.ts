import { z } from "zod";
import { DEFAULT_TRANSLATOR_BASE_URL } from "../src/lib/cloud/scholar-defaults";
import { isSecretMask } from "../src/lib/cloud/settings-secrets";
import {
	mapTranslatorItem,
	publicZoteroUrl,
} from "../src/lib/cloud/zotero-item";

export { mapTranslatorItem } from "../src/lib/cloud/zotero-item";

import { HttpError, json, readJson } from "./http";
import { providerJson, serviceEndpoint } from "./providers";
import { readSettingsSecret } from "./settings";
import type { Env } from "./worker";

const inputSchema = z.object({
	baseUrl: z
		.string()
		.trim()
		.min(1)
		.max(2048)
		.default(DEFAULT_TRANSLATOR_BASE_URL),
	apiKey: z.string().max(16000).optional(),
	operation: z.enum(["lookup", "probe", "import"]),
	query: z.string().trim().min(1).max(4000).optional(),
	content: z
		.string()
		.min(1)
		.max(2 * 1024 * 1024)
		.optional(),
});
export async function translatorRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	if (new URL(request.url).pathname !== "/api/translator") return null;
	if (request.method !== "POST") throw new HttpError(405, "methodNotAllowed");
	const parsed = inputSchema.safeParse(
		await readJson(request, 4 * 1024 * 1024),
	);
	if (!parsed.success) throw new HttpError(400, "invalidRequest");
	const input = parsed.data;
	const query =
		input.operation === "probe"
			? "10.1038/nphys1170"
			: input.operation === "import"
				? input.content
				: input.query;
	if (!query) throw new HttpError(400, "invalidRequest");
	const web = publicZoteroUrl(query);
	const endpoint = serviceEndpoint(
		input.baseUrl,
		input.operation === "import" ? "/import" : web ? "/web" : "/search",
	);
	const key =
		input.baseUrl.replace(/\/+$/, "") === DEFAULT_TRANSLATOR_BASE_URL
			? ""
			: input.apiKey && !isSecretMask(input.apiKey)
				? input.apiKey
				: await readSettingsSecret(env, "translator.apiKey");
	const headers: Record<string, string> = {
		"content-type": "text/plain",
		accept: "application/json",
	};
	if (key) headers.authorization = `Bearer ${key}`;
	const data = await providerJson(
		endpoint,
		{
			method: "POST",
			headers,
			body:
				input.operation === "import"
					? query
					: query.replace(/^(?:ISBN|PMID)\s*:\s*/i, ""),
		},
		request.signal,
	);
	const values = Array.isArray(data) ? data : [data];
	if (values.length > (input.operation === "import" ? 1000 : 100))
		throw new HttpError(502, "invalidProviderResponse");
	const papers = values
		.map((item) =>
			mapTranslatorItem(item, input.operation === "import" ? "" : query),
		)
		.filter((item) => item !== null);
	if (!papers.length) throw new HttpError(404, "paperNotFound");
	const identifier =
		!!web ||
		/^(?:10\.\d{4,9}\/|(?:ISBN|PMID)\s*:|(?:97[89])?[\d-]{9,17}[\dX]$|\d{1,9}$)/i.test(
			query,
		);
	return json({
		exact: input.operation !== "import" && identifier && papers.length === 1,
		papers,
	});
}
