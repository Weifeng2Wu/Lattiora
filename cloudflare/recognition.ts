import { z } from "zod";
import {
	recognitionHit,
	recognitionPayload,
	recognitionProbePayload,
} from "../src/lib/cloud/recognition-protocol";
import { DEFAULT_RECOGNIZER_BASE_URL } from "../src/lib/cloud/scholar-defaults";
import { isSecretMask } from "../src/lib/cloud/settings-secrets";
import { HttpError, json, readJson } from "./http";
import { providerJson, serviceEndpoint } from "./providers";
import { readSettingsSecret } from "./settings";
import type { Env } from "./worker";

const config = z.object({
	baseUrl: z
		.string()
		.trim()
		.min(1)
		.max(2048)
		.default(DEFAULT_RECOGNIZER_BASE_URL),
	apiKey: z.string().max(16000).optional(),
});
const schema = z.discriminatedUnion("operation", [
	config.extend({ operation: z.literal("probe") }),
	config.extend({
		operation: z.literal("recognize"),
		payload: recognitionPayload,
	}),
]);
export async function recognitionRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	if (new URL(request.url).pathname !== "/api/recognize") return null;
	if (request.method !== "POST") throw new HttpError(405, "methodNotAllowed");
	const parsed = schema.safeParse(await readJson(request, 2 * 1024 * 1024));
	if (!parsed.success) throw new HttpError(400, "invalidRequest");
	const input = parsed.data;
	const key =
		input.baseUrl.replace(/\/+$/, "") === DEFAULT_RECOGNIZER_BASE_URL
			? ""
			: input.apiKey && !isSecretMask(input.apiKey)
				? input.apiKey
				: await readSettingsSecret(env, "recognizer.apiKey");
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (key) headers.authorization = `Bearer ${key}`;
	const start = Date.now();
	const payload =
		input.operation === "recognize" ? input.payload : recognitionProbePayload;
	const raw = await providerJson(
		serviceEndpoint(input.baseUrl, ""),
		{ method: "POST", headers, body: JSON.stringify(payload) },
		request.signal,
		30000,
	);
	const hit = recognitionHit.safeParse(raw);
	if (!hit.success) throw new HttpError(502, "invalidProviderResponse");
	return json(
		input.operation === "probe"
			? { ok: true, latencyMs: Date.now() - start }
			: hit.data,
	);
}
