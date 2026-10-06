/**
 * PDF layout-analysis backend selection (Settings → Layout).
 * Mirrors the translate BYOK provider-config pattern: the Host keeps the
 * real API key; the WebView only ever sees a `*` mask.
 */

/**
 * Layout provider ids with remote credentials (shared with the body parser).
 * `agentero` is the built-in parser: the Host injects its compiled-in
 * credential, so it has no user-facing config card. It is a PARSER backend
 * only — layout analysis stays on the local ONNX model (`LAYOUT_BACKENDS`).
 */
export const LAYOUT_PROVIDER_IDS = [
	"agentero",
	"paddle",
	"mineru",
	"openaiCompatible",
] as const;
export type LayoutProviderId = (typeof LAYOUT_PROVIDER_IDS)[number];

/**
 * - `local`: on-device PP-DocLayoutV3 (ONNX in the renderer).
 * - `paddle`: remote PP-StructureV3 async job API (`/api/v2/ocr/jobs`).
 * - `mineru`: remote MinerU batch extract API (`/api/v4/file-urls/batch`).
 */
export const LAYOUT_BACKENDS = ["local", "paddle", "mineru"] as const;
export type LayoutBackend = (typeof LAYOUT_BACKENDS)[number];

/**
 * PAPER.md body-parse engine (`local` = liteparse; the rest run in the cloud
 * and fall back to local on failure). `openaiCompatible` is per-page VLM OCR
 * through an OpenAI-style `/chat/completions` endpoint (SiliconFlow preset).
 * `agentero` is the built-in VLM parser (no user credential); it is a parser
 * backend only and never a layout-analysis backend.
 */
export const PARSER_BACKENDS = [
	"local",
	"agentero",
	"paddle",
	"mineru",
	"openaiCompatible",
] as const;
export type ParserBackend = (typeof PARSER_BACKENDS)[number];

export type LayoutProviderConfig = {
	apiKey: string;
	/** Optional endpoint override; empty → provider default. */
	baseUrl: string;
	/** Model id; empty → provider default. */
	model: string;
	/** OCR prompt override; empty → derived from the model id. */
	prompt: string;
	/** MinerU document language (OCR language pack); one of MINERU_LANGUAGES. */
	language: string;
	/** MinerU force-OCR: OCR every page regardless of the PDF text layer. */
	isOcr: boolean;
};

/**
 * MinerU API `language` options offered in the UI, default first.
 * `ch` covers Chinese (Simplified / Traditional) and English; `en` is
 * pure English. The Host whitelist (`settings/mod.rs`) keeps the full
 * MinerU vocabulary (16 packs incl. `ch_server`) valid when stored.
 */
export const MINERU_LANGUAGES = ["ch", "en"] as const;
export type MineruLanguage = (typeof MINERU_LANGUAGES)[number];

/** Document language used when a provider config has none stored. */
export const DEFAULT_MINERU_LANGUAGE = "ch";

/** Full Host-side whitelist (`settings/mod.rs`); the UI only offers `ch` / `en`. */
const MINERU_LANGUAGE_WHITELIST: readonly string[] = [
	...MINERU_LANGUAGES,
	"ch_server",
	"japan",
	"korean",
	"chinese_cht",
	"ta",
	"te",
	"ka",
	"el",
	"th",
	"latin",
	"arabic",
	"cyrillic",
	"east_slavic",
	"devanagari",
];

export function isMineruLanguage(value: string): boolean {
	return MINERU_LANGUAGE_WHITELIST.includes(value);
}

export type LayoutSettings = {
	backend: LayoutBackend;
	parserBackend: ParserBackend;
	providerConfigs: Partial<Record<LayoutProviderId, LayoutProviderConfig>>;
};

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
	backend: "local",
	parserBackend: "local",
	providerConfigs: {},
};

/** Docs / console pages for obtaining keys (settings UI external link). */
export const LAYOUT_PROVIDER_DOCS_URLS: Record<LayoutProviderId, string> = {
	// Built-in provider has no key page; the card is never rendered.
	agentero: "https://github.com/Weifeng2Wu/Lattiora",
	paddle: "https://aistudio.baidu.com/account/accessToken",
	mineru: "https://mineru.net/apiManage/token",
	openaiCompatible: "https://cloud.siliconflow.cn/i/b9LPNHTG",
};

/** Official endpoints, shown as the Base URL placeholder (override-capable providers only). */
export const LAYOUT_PROVIDER_DEFAULT_BASE_URLS: Partial<
	Record<LayoutProviderId, string>
> = {
	mineru: "https://mineru.net",
	openaiCompatible: "https://api.siliconflow.cn/v1",
};

/** Model-id suggestions offered as a datalist per provider. */
export const PROVIDER_MODEL_PRESETS: Partial<
	Record<LayoutProviderId, readonly string[]>
> = {
	paddle: ["PaddleOCR-VL-1.6", "PaddleOCR-VL-1.5"],
	openaiCompatible: [
		"PaddlePaddle/PaddleOCR-VL-1.5",
		"deepseek-ai/DeepSeek-OCR",
	],
};

export function isLayoutBackend(value: unknown): value is LayoutBackend {
	return (
		typeof value === "string" &&
		(LAYOUT_BACKENDS as readonly string[]).includes(value)
	);
}

export function isParserBackend(value: unknown): value is ParserBackend {
	return (
		typeof value === "string" &&
		(PARSER_BACKENDS as readonly string[]).includes(value)
	);
}

export function isLayoutProviderId(value: unknown): value is LayoutProviderId {
	return (
		typeof value === "string" &&
		(LAYOUT_PROVIDER_IDS as readonly string[]).includes(value)
	);
}

/** Same mask convention as translate BYOK keys (all `*`, same length). */
export function maskLayoutApiKey(key: string): string {
	const n = key.trim().length;
	return n === 0 ? "" : "*".repeat(n);
}

export function isLayoutApiKeyMask(key: string): boolean {
	const t = key.trim();
	return t.length > 0 && t.split("").every((c) => c === "*");
}
