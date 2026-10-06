import i18n from "@/i18n";
import { loadSettings } from "@/lib/settings";
import { langsFromSettings } from "@/lib/translate/lang";
import type {
	TranslateProviderId,
	TranslateRunOptions,
	TranslateTask,
} from "@/lib/translate/types";
import { invokeTranslateText } from "./api";
import { buildTranslatePrompt } from "./prompt";
import type { CommercialTranslateProviderId } from "./types";

/**
 * App-wide translation entry: resolve default provider, run service, return text.
 */
export async function runTranslate(
	partial: Pick<TranslateTask, "text"> &
		Partial<Omit<TranslateTask, "text" | "result" | "error">>,
	opts: TranslateRunOptions = {},
): Promise<string> {
	const text = partial.text?.trim() ?? "";
	if (!text) {
		throw new Error("Empty text");
	}

	const settings = loadSettings();
	const langs = langsFromSettings(settings.translate, i18n.language ?? "en");
	const provider = opts.providerId ?? settings.translate.provider;
	const config =
		opts.providerConfig ??
		settings.translate.providerConfigs[
			provider as CommercialTranslateProviderId
		];
	if (provider === "agent" && opts.agent)
		return opts.agent.runOnce(
			buildTranslatePrompt({
				text,
				targetLangName: langs.targetLangName,
				customPrompt: opts.customPrompt ?? settings.translate.customPrompt,
			}),
		);
	return invokeTranslateText({
		text,
		sourceLang: partial.sourceLang ?? langs.sourceLang,
		targetLang: partial.targetLang ?? langs.targetLang,
		provider,
		...config,
		...(provider === "agent" ? { model: settings.translate.modelId } : {}),
		customPrompt: opts.customPrompt ?? settings.translate.customPrompt,
	});
}

/** Build a task with settings-resolved languages (for consumers that branch UI). */
export function prepareTranslateTask(
	partial: Pick<TranslateTask, "text"> &
		Partial<Omit<TranslateTask, "text" | "result" | "error">>,
): {
	task: TranslateTask;
	providerId: TranslateProviderId;
	targetLangName: string;
	/** Settings-level custom prompt (empty = built-in instructions). */
	customPrompt: string;
} {
	const settings = loadSettings();
	const langs = langsFromSettings(settings.translate, i18n.language ?? "en");
	return {
		providerId: settings.translate.provider,
		targetLangName: langs.targetLangName,
		customPrompt: settings.translate.customPrompt,
		task: {
			text: partial.text,
			sourceLang: partial.sourceLang ?? langs.sourceLang,
			targetLang: partial.targetLang ?? langs.targetLang,
			context: partial.context,
		},
	};
}
