/**
 * Application-level translation service types.
 * Architecture mirrors zotero-pdf-translate's pluggable TranslateService table.
 */

/**
 * Free MT engines (no user-supplied API keys). `agentero` is the built-in
 * provider: the Host injects its compiled-in credential, so the frontend keeps
 * no BYOK config for it and it reuses the keyless free-engine plumbing.
 */
export type FreeTranslateProviderId =
	| "agentero"
	| "google"
	| "googleapi"
	| "deeplx"
	| "huoshanweb"
	| "tencenttransmart";

/** Commercial BYOK engines called directly by the Tauri Host. */
export type CommercialTranslateProviderId =
	| "deepl"
	| "azure"
	| "googleCloud"
	| "openaiCompatible";

export type HostTranslateProviderId =
	| FreeTranslateProviderId
	| CommercialTranslateProviderId;

export type TranslateProviderId = HostTranslateProviderId | "agent";

export type TranslateTargetLang = "ui" | "en" | "zh-CN";

export type TranslateSourceLang = "auto";

export type TranslateSettings = {
	/** App-wide default provider. */
	provider: TranslateProviderId;
	targetLang: TranslateTargetLang;
	sourceLang: TranslateSourceLang;
	/**
	 * Per-provider BYOK config. Stored in the app settings file, not in Vault.
	 */
	providerConfigs: Partial<
		Record<TranslateProviderId, TranslateProviderConfig>
	>;
	/** PDF consumer: auto-run translate after selection (default off). */
	autoTranslateSelection: boolean;
	/**
	 * Open a secondary window with the rendered full-document translation so the
	 * original PDF stays on the left and the translation stays on the right.
	 */
	dualPaneTranslate: boolean;
	/**
	 * Agent seat for provider === "agent".
	 * Empty = follow registry defaultId.
	 */
	agentId: string;
	/**
	 * ACP model id for provider === "agent".
	 * Empty = follow loadModelPref(agentId) / agent current.
	 */
	modelId: string;
	/**
	 * Custom translate prompt replacing the built-in instructions for the
	 * Agent and OpenAI-compatible providers (free MT and the built-in ignore
	 * it). Empty = built-in. Supports {{targetLang}} / {{sourceLang}}; the
	 * source text and [[n]] batch rules are always appended by the app.
	 * Max 8000 chars.
	 */
	customPrompt: string;
};

export type TranslateProviderConfig = {
	apiKey: string;
	/** Optional API base URL / endpoint override. */
	baseUrl: string;
	/** Azure subscription region; ignored by most providers. */
	region: string;
	/** OpenAI-compatible model id. */
	model: string;
};

export type TranslateServiceType = "sentence" | "word";

/** Mutable task state (aligned with Zotero PDF Translate `data`). */
export type TranslateTask = {
	text: string;
	sourceLang: string;
	targetLang: string;
	result?: string;
	error?: string;
	context?: {
		page?: number;
		paperId?: string;
		quote?: string;
		/** e.g. "pdf-selection" */
		surface?: string;
	};
};

export type TranslateRunOptions = {
	/** Override settings.provider for this call. */
	providerId?: TranslateProviderId;
	/** Current BYOK provider config, resolved from settings. */
	providerConfig?: TranslateProviderConfig;
	/**
	 * Agent path: custom prompt override; defaults to
	 * settings.translate.customPrompt (set by `runTranslate`).
	 */
	customPrompt?: string;
	/**
	 * Agent path: inject runner so lib/ does not depend on ACP wiring.
	 * Streaming is the caller's concern; this returns the final string when used.
	 */
	agent?: {
		runOnce: (prompt: string) => Promise<string>;
	};
};

export type TranslateService = {
	id: TranslateProviderId;
	type: TranslateServiceType;
	/** i18n key under settings:translate.provider.* */
	nameKey: string;
	requireSecret: boolean;
	requireExternalConfig?: boolean;
	/** MT engines call Host; agent uses ACP. */
	kind: "free-mt" | "commercial-mt" | "agent";
	translate: (task: TranslateTask, opts: TranslateRunOptions) => Promise<void>;
};

/** Ordered list for settings UI (free engines). */
export const FREE_MT_PROVIDER_IDS: FreeTranslateProviderId[] = [
	"agentero",
	"tencenttransmart",
	"huoshanweb",
	"deeplx",
	"googleapi",
	"google",
];

/** Ordered list for settings UI (commercial BYOK engines). */
export const COMMERCIAL_MT_PROVIDER_IDS: CommercialTranslateProviderId[] = [
	"deepl",
	"azure",
	"googleCloud",
	"openaiCompatible",
];

/**
 * Default API roots when `baseUrl` is empty (Host appends the path suffix).
 * Keep in sync with `optional_endpoint` defaults in
 * `src-tauri/src/features/translate/mod.rs`.
 */
export const COMMERCIAL_MT_DEFAULT_BASE_URLS: Record<
	CommercialTranslateProviderId,
	string
> = {
	deepl: "https://api-free.deepl.com",
	azure: "https://api.cognitive.microsofttranslator.com",
	googleCloud: "https://translation.googleapis.com",
	openaiCompatible: "https://api.openai.com/v1",
};

/** Official docs / console pages for obtaining keys (settings UI external link). */
export const COMMERCIAL_MT_DOCS_URLS: Record<
	CommercialTranslateProviderId,
	string
> = {
	deepl: "https://www.deepl.com/pro-api",
	azure:
		"https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/TextTranslation",
	googleCloud:
		"https://console.cloud.google.com/apis/library/translate.googleapis.com",
	openaiCompatible: "https://platform.openai.com/api-keys",
};

export function isTranslateProviderId(id: string): id is TranslateProviderId {
	if (id === "agent") return true;
	return (
		(FREE_MT_PROVIDER_IDS as string[]).includes(id) ||
		(COMMERCIAL_MT_PROVIDER_IDS as string[]).includes(id)
	);
}

export function isCommercialTranslateProvider(
	id: string,
): id is CommercialTranslateProviderId {
	return (COMMERCIAL_MT_PROVIDER_IDS as string[]).includes(id);
}

export function isFreeMtProvider(id: string): id is FreeTranslateProviderId {
	return (FREE_MT_PROVIDER_IDS as string[]).includes(id);
}
