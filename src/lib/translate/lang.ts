import type {
	TranslateSettings,
	TranslateTargetLang,
} from "@/lib/translate/types";

/** BCP-47 / API code for free MT backends. */
export function resolveTargetLangCode(
	targetLang: TranslateTargetLang,
	uiLanguage: string,
): string {
	if (targetLang === "en") return "en";
	if (targetLang === "zh-CN") return "zh-CN";
	// ui
	return uiLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/**
 * Map a language code (or already-human name) → prompt-facing display name.
 * Single source of truth for Agent prompts.
 */
export function targetLangDisplayName(codeOrName: string): string {
	const raw = codeOrName.trim();
	if (!raw) return "English";
	const c = raw.toLowerCase();
	if (c === "zh" || c === "zh-cn" || c.startsWith("zh-") || c === "chinese") {
		return "Chinese";
	}
	if (c === "en" || c.startsWith("en-") || c === "english") {
		return "English";
	}
	// Unknown code / custom name: pass through for prompt flexibility.
	return raw;
}

/** Human-readable name for Agent prompts. */
export function resolveTargetLangName(
	targetLang: TranslateTargetLang,
	uiLanguage: string,
): string {
	return targetLangDisplayName(resolveTargetLangCode(targetLang, uiLanguage));
}

export function resolveSourceLangCode(sourceLang: string): string {
	const s = sourceLang.trim().toLowerCase();
	if (!s || s === "auto") return "auto";
	return sourceLang.trim();
}

/** Map settings + UI locale → codes used by runTranslate. */
export function langsFromSettings(
	settings: Pick<TranslateSettings, "sourceLang" | "targetLang">,
	uiLanguage: string,
): { sourceLang: string; targetLang: string; targetLangName: string } {
	return {
		sourceLang: resolveSourceLangCode(settings.sourceLang),
		targetLang: resolveTargetLangCode(settings.targetLang, uiLanguage),
		targetLangName: resolveTargetLangName(settings.targetLang, uiLanguage),
	};
}
