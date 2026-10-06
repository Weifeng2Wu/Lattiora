import { z } from "zod";
import { isSecretMask } from "../src/lib/cloud/settings-secrets";
import { translateBaseUrl } from "../src/lib/translate/defaults";
import { buildTranslatePrompt } from "../src/lib/translate/prompt";
import { getAiConfig } from "./ai";
import { HttpError, json, readJson } from "./http";
import { completeModel, providerJson, serviceEndpoint } from "./providers";
import { readSettingsSecret } from "./settings";
import type { Env } from "./worker";

const schema = z
	.object({
		provider: z.enum([
			"agentero",
			"agent",
			"google",
			"googleapi",
			"deeplx",
			"huoshanweb",
			"tencenttransmart",
			"deepl",
			"azure",
			"googleCloud",
			"openaiCompatible",
		]),
		text: z.string().min(1).max(48000),
		sourceLang: z.string().max(24).default("auto"),
		targetLang: z.string().min(1).max(24),
		baseUrl: z.string().max(2048).optional(),
		apiKey: z.string().max(16000).optional(),
		region: z.string().max(100).optional(),
		model: z.string().max(200).optional(),
		customPrompt: z.string().max(8000).optional(),
		timeoutMs: z.number().min(1000).max(60000).optional(),
	})
	.strict();
export type TranslationInput = z.infer<typeof schema>;
const baseLang = (value: string) => value.split(/[-_]/)[0].toLowerCase();

export async function translateProvider(
	input: TranslationInput,
	env: Env,
	signal: AbortSignal,
): Promise<string> {
	const { provider, text, sourceLang: source, targetLang: target } = input;
	const targetName =
		baseLang(target) === "zh"
			? "Simplified Chinese"
			: baseLang(target) === "en"
				? "English"
				: target;
	const prompt = buildTranslatePrompt({
		text,
		targetLangName: targetName,
		customPrompt: input.customPrompt,
	});
	if (provider === "agent" || provider === "agentero") {
		const config = await getAiConfig(env);
		if (!config) throw new HttpError(409, "aiNotConfigured");
		return completeModel(
			{ ...config, model: input.model || config.model },
			prompt,
			signal,
		);
	}
	const baseUrl = translateBaseUrl(provider, input.baseUrl);
	if (!baseUrl) throw new HttpError(409, "endpointRequired");
	const commercial = [
		"deepl",
		"azure",
		"googleCloud",
		"openaiCompatible",
	].includes(provider);
	const key = commercial
		? input.apiKey && !isSecretMask(input.apiKey)
			? input.apiKey
			: await readSettingsSecret(
					env,
					`translate.providerConfigs.${provider}.apiKey`,
				)
		: "";
	if (commercial && !key) throw new HttpError(409, "aiNotConfigured");
	if (provider === "openaiCompatible") {
		if (!input.model) throw new HttpError(400, "invalidConfig");
		const url = serviceEndpoint(baseUrl, "/chat/completions");
		return completeModel(
			{
				provider: "openai",
				baseUrl: url.toString(),
				apiKey: key,
				model: input.model,
			},
			prompt,
			signal,
		);
	}
	let url: string | URL;
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"user-agent": "Mozilla/5.0 Lattiora",
	};
	let body: unknown;
	let init: RequestInit = { method: "POST", headers };
	if (provider === "google" || provider === "googleapi") {
		url = serviceEndpoint(baseUrl, "/translate_a/single");
		url.search = new URLSearchParams({
			client: "gtx",
			sl: source,
			tl: target,
			dt: "t",
			q: text,
		}).toString();
		init = { method: "GET", headers };
	} else if (provider === "deepl") {
		url = serviceEndpoint(baseUrl, "/v2/translate");
		headers.authorization = `DeepL-Auth-Key ${key}`;
		headers["content-type"] = "application/x-www-form-urlencoded";
		init.body = new URLSearchParams({
			text,
			target_lang: baseLang(target).toUpperCase(),
			...(source !== "auto"
				? { source_lang: baseLang(source).toUpperCase() }
				: {}),
		});
	} else if (provider === "azure") {
		if (!input.region) throw new HttpError(400, "invalidConfig");
		url = serviceEndpoint(baseUrl, "/translate");
		url.search = new URLSearchParams({
			"api-version": "3.0",
			to: baseLang(target) === "zh" ? "zh-Hans" : target,
			...(source !== "auto" ? { from: source } : {}),
		}).toString();
		headers["Ocp-Apim-Subscription-Key"] = key;
		headers["Ocp-Apim-Subscription-Region"] = input.region;
		body = [{ Text: text }];
	} else if (provider === "googleCloud") {
		url = serviceEndpoint(baseUrl, "/language/translate/v2");
		headers["x-goog-api-key"] = key;
		body = {
			q: text,
			target,
			format: "text",
			...(source !== "auto" ? { source } : {}),
		};
	} else if (provider === "huoshanweb") {
		url = serviceEndpoint(baseUrl, "/crx/translate/v1");
		body = {
			source_language: baseLang(source),
			target_language: baseLang(target),
			text,
		};
	} else if (provider === "tencenttransmart") {
		url = serviceEndpoint(baseUrl, "/api/imt");
		headers.referer = "https://transmart.qq.com/zh-CN/index";
		body = {
			header: {
				fn: "auto_translation",
				client_key: `browser-chrome-110.0.0-Mac OS-${crypto.randomUUID()}-${Date.now()}`,
			},
			type: "plain",
			model_category: "normal",
			source: { lang: baseLang(source), text_list: [text] },
			target: { lang: baseLang(target) },
		};
	} else {
		url = serviceEndpoint(baseUrl, "/jsonrpc");
		url.search = "client=chrome-extension,1.28.0&method=LMT_handle_jobs";
		headers.origin = "chrome-extension://cofdbpoegempjloogbagkncekinflcnj";
		headers.referer = "https://www.deepl.com/";
		const id = 8300000001 + (Date.now() % 99999) * 1000;
		const count = (text.match(/i/gi)?.length ?? 0) + 1;
		body = {
			jsonrpc: "2.0",
			method: "LMT_handle_texts",
			id,
			params: {
				texts: [{ text, requestAlternatives: 3 }],
				splitting: "newlines",
				lang: {
					source_lang_user_selected: baseLang(source).toUpperCase(),
					target_lang: baseLang(target).toUpperCase(),
				},
				timestamp: Date.now() - (Date.now() % count) + count,
				commonJobParams: { wasSpoken: false, transcribe_as: "" },
			},
		};
		init.body = JSON.stringify(body).replace(
			'"method":"',
			(id + 5) % 29 === 0 || (id + 3) % 13 === 0
				? '"method" : "'
				: '"method": "',
		);
	}
	if (body !== undefined && !init.body) init.body = JSON.stringify(body);
	const data = (await providerJson(
		url,
		init,
		signal,
		input.timeoutMs,
	)) as Record<string, any>;
	let result: unknown;
	if (provider === "google" || provider === "googleapi")
		result = Array.isArray(data?.[0])
			? data[0]
					.map((part: unknown[]) =>
						typeof part?.[0] === "string" ? part[0] : "",
					)
					.join("")
			: null;
	else if (provider === "deepl") result = data?.translations?.[0]?.text;
	else if (provider === "azure") result = data?.[0]?.translations?.[0]?.text;
	else if (provider === "googleCloud")
		result = data?.data?.translations?.[0]?.translatedText;
	else if (provider === "huoshanweb") result = data?.translation;
	else if (provider === "tencenttransmart")
		result =
			Array.isArray(data?.auto_translation) &&
			data.auto_translation.every((part: unknown) => typeof part === "string")
				? data.auto_translation.join("\n").trim()
				: null;
	else result = data?.result?.texts?.[0]?.text;
	if (typeof result !== "string" || !result.trim())
		throw new HttpError(502, "invalidProviderResponse");
	return result;
}
export async function translateRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	if (new URL(request.url).pathname !== "/api/translate") return null;
	if (request.method !== "POST") throw new HttpError(405, "methodNotAllowed");
	const parsed = schema.safeParse(await readJson(request, 256000));
	if (!parsed.success) throw new HttpError(400, "invalidRequest");
	return json({
		text: await translateProvider(parsed.data, env, request.signal),
	});
}
