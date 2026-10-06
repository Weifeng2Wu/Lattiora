/** Public Zotero-compatible services; custom endpoints remain supported. */
export const DEFAULT_RECOGNIZER_BASE_URL =
	"https://services.zotero.org/recognizer/recognize";
export const DEFAULT_TRANSLATOR_BASE_URL = "https://translate.manubot.org";

export type ScholarServiceConfig = {
	baseUrl: string;
	apiKey: string;
	enabled?: boolean;
};

export function normalizeScholarService(
	config: Partial<ScholarServiceConfig> | undefined,
	defaultUrl: string,
): ScholarServiceConfig {
	const apiKey = typeof config?.apiKey === "string" ? config.apiKey : "";
	return {
		// Never redirect an existing custom credential to a default public service.
		baseUrl:
			(typeof config?.baseUrl === "string" ? config.baseUrl.trim() : "") ||
			(apiKey.trim() ? "" : defaultUrl),
		apiKey,
		enabled: config?.enabled !== false,
	};
}
