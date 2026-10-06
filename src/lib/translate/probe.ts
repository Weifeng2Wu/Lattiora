/**
 * Availability probes for free MT and commercial BYOK providers (excludes Agent).
 * Used by Settings → Translate when the default-service Select opens or on Confirm.
 */

import { BUILTIN_PROVIDER_ID } from "@/lib/core/builtin";
import type {
	CommercialTranslateProviderId,
	FreeTranslateProviderId,
	TranslateProviderConfig,
} from "@/lib/translate/types";
import { FREE_MT_PROVIDER_IDS } from "@/lib/translate/types";
import type { ProbeStatus } from "@/lib/ui/probe-status";
import { invokeTranslateText } from "./api";

/** Host timeout for each probe request (ms). */
export const TRANSLATE_PROBE_TIMEOUT_MS = 5_000;

export type FreeMtProbeStatus = ProbeStatus;

export type FreeMtProbeMap = Partial<
	Record<FreeTranslateProviderId, FreeMtProbeStatus>
>;

export type CommercialMtProbeMap = Partial<
	Record<CommercialTranslateProviderId, FreeMtProbeStatus>
>;

export type ProbeFreeMtOptions = {
	/** Per-request timeout; default {@link TRANSLATE_PROBE_TIMEOUT_MS}. */
	timeoutMs?: number;
	/** Called as each provider finishes (progressive UI). */
	onResult?: (id: FreeTranslateProviderId, ok: boolean) => void;
	/**
	 * Optional abort: when aborted, remaining probes still resolve as fail
	 * (Tauri invoke cannot cancel in-flight host work).
	 */
	signal?: AbortSignal;
};

export type ProbeCommercialMtOptions = {
	config: TranslateProviderConfig;
	/** Per-request timeout; default {@link TRANSLATE_PROBE_TIMEOUT_MS}. */
	timeoutMs?: number;
	signal?: AbortSignal;
};

/**
 * Host redacts a commercial API key to the same number of `*` characters.
 * Must match `mask_translate_api_key` / `is_translate_api_key_mask` in
 * `src-tauri/.../settings/mod.rs`.
 */
export function maskTranslateApiKey(apiKey: string): string {
	const n = [...apiKey.trim()].length;
	return n === 0 ? "" : "*".repeat(n);
}

export function isTranslateApiKeyMask(apiKey: string | undefined): boolean {
	const t = apiKey?.trim() ?? "";
	return t.length > 0 && /^\*+$/.test(t);
}

/** True when a non-empty key is stored (plaintext or host `*`-mask). */
export function hasTranslateApiKey(apiKey: string | undefined): boolean {
	return Boolean(apiKey?.trim());
}

export function isCommercialProviderConfigured(
	id: CommercialTranslateProviderId,
	config: TranslateProviderConfig | undefined,
): boolean {
	if (!hasTranslateApiKey(config?.apiKey) || !config?.baseUrl.trim())
		return false;
	if (id === "azure" && !config?.region.trim()) return false;
	if (id === "openaiCompatible" && !config?.model.trim()) return false;
	return true;
}

async function probeOne(
	id: FreeTranslateProviderId,
	opts: ProbeFreeMtOptions,
): Promise<boolean> {
	if (opts.signal?.aborted) return false;
	try {
		return Boolean(
			await invokeTranslateText({
				provider: id,
				text: "Hello",
				sourceLang: "en",
				targetLang: "zh-CN",
				timeoutMs: opts.timeoutMs ?? TRANSLATE_PROBE_TIMEOUT_MS,
				signal: opts.signal,
			}),
		);
	} catch {
		return false;
	}
}

/**
 * Probe all free MT engines in parallel (not Agent).
 * Results stream via `onResult`; returned map is the final snapshot.
 *
 * The built-in provider is excluded: probing it would fire a real translation
 * request, and its availability comes from `builtinProviderStatus` instead.
 */
export async function probeFreeMtProviders(
	opts: ProbeFreeMtOptions = {},
): Promise<Record<FreeTranslateProviderId, boolean>> {
	const results = await Promise.all(
		FREE_MT_PROVIDER_IDS.filter((id) => id !== BUILTIN_PROVIDER_ID).map(
			async (id) => {
				const ok = await probeOne(id, opts);
				opts.onResult?.(id, ok);
				return [id, ok] as const;
			},
		),
	);
	const map = {} as Record<FreeTranslateProviderId, boolean>;
	for (const [id, ok] of results) {
		map[id] = ok;
	}
	return map;
}

export async function probeCommercialMtProvider(
	id: CommercialTranslateProviderId,
	opts: ProbeCommercialMtOptions,
): Promise<boolean> {
	if (opts.signal?.aborted) return false;
	if (!isCommercialProviderConfigured(id, opts.config)) return false;
	try {
		return Boolean(
			await invokeTranslateText({
				provider: id,
				text: "Hello",
				sourceLang: "en",
				targetLang: "zh-CN",
				...opts.config,
				timeoutMs: opts.timeoutMs ?? TRANSLATE_PROBE_TIMEOUT_MS,
				signal: opts.signal,
			}),
		);
	} catch {
		return false;
	}
}
