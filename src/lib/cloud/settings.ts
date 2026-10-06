import type { AppSettings } from "@/lib/settings/types";
import { readLocalFile, writeLocalFile } from "./files";
import {
	isSecretMask,
	redactSettings,
	settingsSecretValues,
} from "./settings-secrets";
import { cloudFetch } from "./sync";

export const SETTINGS_FILE = ".agentero/settings.json";
let storedText: string | undefined;
let versions: Map<string, number> | undefined;

export async function refreshSettingsSecrets(): Promise<void> {
	const response = await cloudFetch("/api/settings/secrets");
	const data = (await response.json()) as {
		secrets: Array<{ name: string; version: number }>;
	};
	versions = new Map(data.secrets.map((row) => [row.name, row.version]));
}

export async function readCloudSettings(): Promise<Partial<AppSettings> | null> {
	let blob: Blob;
	try {
		blob = await readLocalFile(SETTINGS_FILE);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("File not found:")) {
			storedText = undefined;
			return null;
		}
		throw error;
	}
	const text = await blob.text();
	const parsed: unknown = JSON.parse(text);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("invalidConfig");
	storedText = text;
	return redactSettings(parsed as Partial<AppSettings>);
}

/** Called from the serialized store writer. Secret edits require an online session. */
export async function persistCloudSettings(
	next: AppSettings,
	previous: AppSettings,
): Promise<AppSettings> {
	const previousKeys = settingsSecretValues(previous);
	const edits = Object.entries(settingsSecretValues(next)).filter(
		([path, value]) =>
			!isSecretMask(value) && value !== (previousKeys[path] ?? ""),
	);
	if (edits.length) {
		if (!navigator.onLine) throw new Error("settingsKeyOnline");
		if (!versions) await refreshSettingsSecrets();
		for (const [name, value] of edits) {
			const response = await cloudFetch("/api/settings/secrets", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name,
					value,
					version: versions!.get(name) ?? 0,
				}),
			});
			const result = (await response.json()) as { version: number };
			versions!.set(name, result.version);
		}
	}
	const publicSettings = redactSettings(next);
	const text = JSON.stringify(publicSettings);
	if (text !== storedText) {
		await writeLocalFile(
			SETTINGS_FILE,
			new Blob([text], { type: "application/json" }),
			{
				expectedText: storedText ?? null,
				preserveConflict: true,
			},
		);
		storedText = text;
	}
	return publicSettings;
}
