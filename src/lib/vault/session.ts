import i18n from "@/i18n";
import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";
import { isRemoteVaultHandle } from "@/lib/vault/remote/remote-vault";

/** Per-window vault (sessionStorage — isolated across ⌘N windows). */
const SESSION_VAULT_KEY = "agentero-vault-path";
/** Last opened vault for “restore last vault” on the primary window. */
const LAST_VAULT_KEY = "agentero-vault-path";
/** MRU list for welcome screen (localStorage, shared). */
const RECENT_VAULTS_KEY = "agentero-recent-vaults";
const MAX_RECENT_VAULTS = 8;

/** True when this window was opened via ⌘N / New Window (`?fresh=1`). */
export function isFreshWindow(): boolean {
	try {
		return new URLSearchParams(window.location.search).get("fresh") === "1";
	} catch {
		return false;
	}
}

export function getSessionVaultPath(): string | null {
	try {
		return sessionStorage.getItem(SESSION_VAULT_KEY);
	} catch {
		return null;
	}
}

/** Last vault path (localStorage) — used when restore-last is enabled. */
export function getLastVaultPath(): string | null {
	try {
		const last = localStorage.getItem(LAST_VAULT_KEY);
		// Drop stale remote handles left by older builds (session no longer exists).
		if (last && isRemoteVaultHandle(last)) return null;
		return last;
	} catch {
		return null;
	}
}

/**
 * Resolve initial vault for this window:
 * 1. Session path if already chosen in this window
 * 2. Never auto-open on fresh (⌘N) windows
 * 3. Otherwise last vault when caller enables restore
 */
export function getSavedVaultPath(opts?: {
	allowRestore?: boolean;
}): string | null {
	const session = getSessionVaultPath();
	// Keep whatever this window already opened (incl. live `remote:<id>` handle).
	if (session) return session;
	if (isFreshWindow()) return null;
	if (opts?.allowRestore === false) return null;
	// Cross-launch restore: local path only (remote needs SSH re-connect).
	return getLastVaultPath();
}

export function getRecentVaults(): string[] {
	// null sentinel = key missing (migrate from single last-vault once).
	const parsed = readJsonStorage<unknown>(RECENT_VAULTS_KEY, null);
	if (parsed == null) {
		const last = getLastVaultPath();
		return last ? [last] : [];
	}
	if (!Array.isArray(parsed)) return [];
	const list = parsed.filter(
		(p): p is string =>
			typeof p === "string" && p.length > 0 && !isRemoteVaultHandle(p),
	);
	// Self-heal: strip remote handles written by older builds.
	if (list.length !== parsed.length) {
		writeJsonStorage(RECENT_VAULTS_KEY, list);
	}
	return list;
}

export function rememberRecentVault(path: string): void {
	const normalized = path.replace(/[\\/]+$/, "");
	if (!normalized || isRemoteVaultHandle(normalized)) return;
	const next = [
		normalized,
		...getRecentVaults().filter((p) => p.replace(/[\\/]+$/, "") !== normalized),
	].slice(0, MAX_RECENT_VAULTS);
	writeJsonStorage(RECENT_VAULTS_KEY, next);
}

export function removeRecentVault(path: string): void {
	const normalized = path.replace(/[\\/]+$/, "");
	const next = getRecentVaults().filter(
		(p) => p.replace(/[\\/]+$/, "") !== normalized,
	);
	writeJsonStorage(RECENT_VAULTS_KEY, next);
}

export function saveVaultPath(path: string | null): void {
	try {
		if (path) {
			// Always keep window-session binding (local path or live remote handle).
			sessionStorage.setItem(SESSION_VAULT_KEY, path);
			// Durable "last / recent local" only for real filesystem roots.
			if (!isRemoteVaultHandle(path)) {
				localStorage.setItem(LAST_VAULT_KEY, path);
				rememberRecentVault(path);
			}
		} else {
			sessionStorage.removeItem(SESSION_VAULT_KEY);
		}
	} catch {
		// ignore quota / private mode
	}
}

/** Open a new Agentero window without restoring a vault (desktop only). */
export async function openNewWindow(): Promise<void> {
	throw new Error(i18n.t("app:vault.openDesktopOnly"));
}
