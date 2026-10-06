import { type AiConfig, providerEndpoint } from "../src/lib/cloud/protocol";
import { getAiConfig, providerRequest } from "./ai";
import { HttpError, json, readBytes, readJson } from "./http";

/** Same endpoint boundary as chat; never follow redirects with provider credentials. */
export function serviceEndpoint(base: string, suffix: string): URL {
	try {
		providerEndpoint(base, "openai");
	} catch {
		throw new HttpError(400, "invalidEndpoint");
	}
	const url = new URL(base);
	const path = url.pathname.replace(/\/+$/, "");
	url.pathname = path.endsWith(suffix) ? path : `${path}${suffix}`;
	return url;
}
export async function providerJson(
	url: string | URL,
	init: RequestInit,
	signal: AbortSignal,
	timeout = 60_000,
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, {
			...init,
			redirect: "manual",
			signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
		});
	} catch {
		throw new HttpError(502, "providerUnavailable");
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new HttpError(
			response.status === 429 ? 429 : 502,
			response.status === 429 ? "tryLater" : "providerError",
		);
	}
	try {
		return JSON.parse(
			new TextDecoder().decode(await readBytes(response, 4 * 1024 * 1024)),
		);
	} catch {
		throw new HttpError(502, "invalidProviderResponse");
	}
}
export async function completeModel(
	config: AiConfig,
	prompt: string,
	signal: AbortSignal,
	maxTokens = 8192,
): Promise<string> {
	const { url, init } = providerRequest(
		config,
		[{ role: "user", content: prompt }],
		"",
		"Follow the user's task. Return only the requested result.",
	);
	const body = {
		...JSON.parse(String(init.body)),
		stream: false,
		max_tokens: maxTokens,
	};
	if (config.provider === "openai") body.temperature = 0.2;
	const data = (await providerJson(
		url,
		{ ...init, body: JSON.stringify(body) },
		signal,
	)) as {
		choices?: Array<{ message?: { content?: string } }>;
		content?: Array<{ type?: string; text?: string }>;
	};
	const text =
		config.provider === "anthropic"
			? data?.content
					?.filter((part) => part.type === "text")
					.map((part) => part.text ?? "")
					.join("")
			: data?.choices?.[0]?.message?.content;
	if (typeof text !== "string" || !text.trim())
		throw new HttpError(502, "invalidProviderResponse");
	return text;
}

/** Exercise the actual draft model and protocol without persisting the draft key. */
export async function modelProbeRoutes(
	request: Request,
	env: import("./worker").Env,
): Promise<Response | null> {
	if (
		new URL(request.url).pathname !== "/api/ai/probe" ||
		request.method !== "POST"
	)
		return null;
	const data = (await readJson(request, 20000)) as Partial<AiConfig>;
	if (
		!data ||
		!["openai", "anthropic"].includes(data.provider ?? "") ||
		typeof data.baseUrl !== "string" ||
		data.baseUrl.length > 2048 ||
		typeof data.model !== "string" ||
		!data.model.trim() ||
		data.model.length > 200 ||
		(data.apiKey !== undefined &&
			(typeof data.apiKey !== "string" || data.apiKey.length > 16000))
	)
		throw new HttpError(400, "invalidConfig");
	serviceEndpoint(data.baseUrl, "");
	const saved = data.apiKey?.trim() ? null : await getAiConfig(env);
	const sameEndpoint =
		saved !== null &&
		saved.provider === data.provider &&
		saved.baseUrl === data.baseUrl;
	const apiKey = data.apiKey?.trim() || (sameEndpoint ? saved?.apiKey : "");
	if (!apiKey) throw new HttpError(409, "aiNotConfigured");
	const start = Date.now();
	await completeModel(
		{
			provider: data.provider as AiConfig["provider"],
			baseUrl: data.baseUrl,
			model: data.model,
			apiKey,
		},
		"Reply with OK.",
		request.signal,
		16,
	);
	return json({ ok: true, latencyMs: Date.now() - start });
}
