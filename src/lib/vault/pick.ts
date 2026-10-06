import i18n from "@/i18n";
import type { CreateVaultResult } from "@/lib/vault/types";

export async function pickVaultDirectory(): Promise<string | null> {
	throw new Error(i18n.t("app:vault.openDesktopOnly"));
}

/** Pick a directory that will be scaffolded as a new Agentero vault. */
export async function pickCreateVaultDirectory(
	_title = i18n.t("app:vault.createDialogTitle"),
): Promise<string | null> {
	throw new Error(i18n.t("app:vault.createDesktopOnly"));
}

/**
 * Scaffold a Agentero vault at `path` (Host: vault_create).
 * Creates papers/notes/.agentero, AGENTS.md, catalog.sqlite.
 * Does not create PAPERS.md / library.bib. Does not overwrite existing files.
 */
export async function createVault(
	_path: string,
	_locale?: string,
): Promise<CreateVaultResult> {
	throw new Error(i18n.t("app:vault.createDesktopOnly"));
}

/**
 * Idempotent ensure for an open vault (Host: vault_ensure).
 * Seeds missing bundled skills and updates only first-party skills whose bytes
 * still match a known bundled version. User-edited files are preserved.
 */
export async function ensureVault(
	_path: string,
	_locale?: string,
): Promise<CreateVaultResult> {
	throw new Error(i18n.t("app:vault.createDesktopOnly"));
}

/**
 * Skill package ids newly written under `.agents/skills/<id>/…`
 * (from `CreateVaultResult.created`). Ignores top-level README/LICENSE.
 */
export function seededSkillIdsFromCreated(created: string[]): string[] {
	const ids = new Set<string>();
	for (const raw of created) {
		const rel = raw.replace(/\\/g, "/");
		const m = /^\.agents\/skills\/([^/]+)\//.exec(rel);
		if (m?.[1]) ids.add(m[1]);
	}
	return [...ids].sort((a, b) => a.localeCompare(b));
}
