import { cloudAiError } from "@/lib/cloud/ai";
import { cloudFetch } from "@/lib/cloud/sync";
import type {
	TranslateTextArgs,
	TranslateTextResult,
} from "@/lib/core/bindings";
import { loadSettings } from "@/lib/settings/store";
import { translateBaseUrl } from "./defaults";
import { isTranslateProviderId } from "./types";

/** Host marker for "the built-in provider has no compiled-in key". */
export const ERR_TRANSLATE_NO_BUILTIN_KEY = "translate.no_builtin_key";

export type { TranslateTextArgs, TranslateTextResult };

/**
 * Host MT command via the generated typed binding (tauri-specta pilot).
 * `provider` selects a free web engine or a commercial BYOK engine.
 * Regenerate bindings: `cargo test -p agentero export_typescript_bindings`.
 */
export async function invokeTranslateText(args: {
	text: string;
	sourceLang: string;
	targetLang: string;
	provider: string;
	apiKey?: string;
	baseUrl?: string;
	region?: string;
	model?: string;
	/** Host request timeout (ms); clamped 1s–30s server-side. */
	timeoutMs?: number;
	customPrompt?: string;
	signal?: AbortSignal;
}): Promise<string> {
	try {
		const { signal, ...input } = args;
		if (isTranslateProviderId(input.provider))
			input.baseUrl = translateBaseUrl(
				input.provider,
				input.baseUrl ??
					loadSettings().translate.providerConfigs[input.provider]?.baseUrl,
			);
		const response = await cloudFetch("/api/translate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
			signal,
		});
		return ((await response.json()) as { text: string }).text;
	} catch (error) {
		throw new Error(cloudAiError(error));
	}
}
