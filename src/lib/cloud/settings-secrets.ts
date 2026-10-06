/** Explicit secret paths shared by browser and Worker; values never enter file sync. */
export const SETTINGS_SECRET_PATHS = [
	"easyScholarKey",
	"scholar.apiKey",
	"recognizer.apiKey",
	"translator.apiKey",
	"embedding.apiKey",
	"translate.providerConfigs.deepl.apiKey",
	"translate.providerConfigs.azure.apiKey",
	"translate.providerConfigs.googleCloud.apiKey",
	"translate.providerConfigs.openaiCompatible.apiKey",
	"layout.providerConfigs.paddle.apiKey",
	"layout.providerConfigs.mineru.apiKey",
	"layout.providerConfigs.openaiCompatible.apiKey",
] as const;
export type SettingsSecretPath = (typeof SETTINGS_SECRET_PATHS)[number];
export const SECRET_MASK = "********";
export const isSecretMask = (value: string) => /^\*+$/.test(value);

export function settingsSecretValues(value: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	for (const path of SETTINGS_SECRET_PATHS) {
		let child: unknown = value;
		for (const key of path.split("."))
			child =
				child && typeof child === "object"
					? (child as Record<string, unknown>)[key]
					: undefined;
		if (typeof child === "string") result[path] = child;
	}
	return result;
}

/** Defense in depth: also strip retired/unknown credential fields on import. */
export function redactSettings<T>(value: T, mask = SECRET_MASK): T {
	if (Array.isArray(value))
		return value.map((child) => redactSettings(child, mask)) as T;
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => [
			key,
			/(api.?key|secret|password|token|easyScholarKey)$/i.test(key) &&
			typeof child === "string"
				? child
					? mask
					: ""
				: redactSettings(child, mask),
		]),
	) as T;
}
