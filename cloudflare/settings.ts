import {
	isSecretMask,
	SETTINGS_SECRET_PATHS,
} from "../src/lib/cloud/settings-secrets";
import { HttpError, json, readJson } from "./http";
import { providerJson } from "./providers";
import { decrypt, encrypt } from "./security";
import type { Env } from "./worker";

export async function readSettingsSecret(
	env: Env,
	name: string,
): Promise<string> {
	const row = await env.DB.prepare(
		"SELECT value FROM settings_secrets WHERE name = ? AND configured = 1",
	)
		.bind(name)
		.first<{ value: string }>();
	return row
		? decrypt<string>(
				row.value,
				env.ENCRYPTION_KEY,
				`agentero-settings-v1:${name}`,
			)
		: "";
}

export async function settingsRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname === "/api/easyscholar" && request.method === "POST") {
		const input = (await readJson(request, 4096)) as { publication?: unknown };
		if (
			!input ||
			typeof input.publication !== "string" ||
			!input.publication.trim() ||
			input.publication.length > 1000
		)
			throw new HttpError(400, "invalidRequest");
		const key = await readSettingsSecret(env, "easyScholarKey");
		if (!key) throw new HttpError(409, "aiNotConfigured");
		const endpoint = new URL("https://easyscholar.cc/open/getPublicationRank");
		endpoint.search = new URLSearchParams({
			secretKey: key,
			publicationName: input.publication.trim(),
		}).toString();
		const data = (await providerJson(
			endpoint,
			{ method: "GET" },
			request.signal,
		)) as {
			code?: number;
			data?: { officialRank?: { all?: Record<string, unknown> } };
		};
		if (data?.code !== 200 || !data?.data?.officialRank?.all)
			throw new HttpError(502, "providerError");
		const all = Object.fromEntries(
			Object.entries(data.data.officialRank.all).filter(
				([, v]) => typeof v === "string" || typeof v === "number",
			),
		);
		return json({ code: 200, data: { officialRank: { all } } });
	}
	if (url.pathname !== "/api/settings/secrets") return null;
	if (request.method === "GET") {
		const { results } = await env.DB.prepare(
			"SELECT name, version, configured FROM settings_secrets",
		).all();
		return json({ secrets: results });
	}
	if (request.method !== "PUT") throw new HttpError(405, "methodNotAllowed");
	const input = (await readJson(request, 20000)) as {
		name?: unknown;
		version?: unknown;
		value?: unknown;
	};
	if (
		!input ||
		typeof input.name !== "string" ||
		!(SETTINGS_SECRET_PATHS as readonly string[]).includes(input.name) ||
		!Number.isSafeInteger(input.version) ||
		Number(input.version) < 0 ||
		typeof input.value !== "string" ||
		input.value.length > 16000 ||
		isSecretMask(input.value)
	)
		throw new HttpError(400, "invalidConfig");
	const ciphertext = await encrypt(
		input.value,
		env.ENCRYPTION_KEY,
		`agentero-settings-v1:${input.name}`,
	);
	const result =
		await env.DB.prepare(`INSERT INTO settings_secrets (name, version, value, configured, updated_at)
		SELECT ?, 1, ?, ?, ? WHERE ? = 0
		ON CONFLICT(name) DO NOTHING RETURNING version`)
			.bind(
				input.name,
				ciphertext,
				input.value ? 1 : 0,
				Date.now(),
				input.version,
			)
			.first<{ version: number }>();
	const updated =
		result ??
		(await env.DB.prepare(
			`UPDATE settings_secrets SET version = version + 1, value = ?, configured = ?, updated_at = ? WHERE name = ? AND version = ? RETURNING version`,
		)
			.bind(
				ciphertext,
				input.value ? 1 : 0,
				Date.now(),
				input.name,
				input.version,
			)
			.first<{ version: number }>());
	if (!updated) throw new HttpError(409, "settingsSecretConflict");
	return json({ version: updated.version, configured: Boolean(input.value) });
}
