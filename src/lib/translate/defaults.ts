import type {
	TranslateProviderConfig,
	TranslateProviderId,
	TranslateSettings,
} from "./types";

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
	/** No bundled service: requires the owner’s AI configuration. */
	provider: "agent",
	targetLang: "ui",
	sourceLang: "auto",
	providerConfigs: {},
	autoTranslateSelection: false,
	dualPaneTranslate: false,
	agentId: "",
	modelId: "",
	customPrompt: "",
};

/** Blank commercial provider config (missing draft/stored entry fallback). */
export const EMPTY_TRANSLATE_PROVIDER_CONFIG: TranslateProviderConfig = {
	apiKey: "",
	baseUrl: "",
	region: "",
	model: "",
};

/** Public keyless endpoints; explicit user endpoints always take precedence. */
export const FREE_MT_DEFAULT_BASE_URLS: Partial<
	Record<TranslateProviderId, string>
> = {
	tencenttransmart: "https://transmart.qq.com",
	google: "https://translate.google.com",
	googleapi: "https://translate.googleapis.com",
};

export function translateBaseUrl(
	provider: TranslateProviderId,
	override?: string,
): string {
	return override?.trim() || FREE_MT_DEFAULT_BASE_URLS[provider] || "";
}
