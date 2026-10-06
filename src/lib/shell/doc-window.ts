/**
 * Per-path document native windows.
 */

import i18n from "@/i18n";
import { notifyError } from "@/lib/core/notify";

/** Open or focus a document window for `path`. */
export async function openDocWindow(
	_path: string,
	_mode?: string | null,
	_opts?: { title?: string | null },
): Promise<void> {
	notifyError(i18n.t("app:windows.docDesktopOnly"));
	return;
}

export function readDocWindowParams(): {
	path: string | null;
	mode: string | null;
	vaultPath: string | null;
} {
	try {
		const params = new URLSearchParams(window.location.search);
		return {
			path: params.get("path"),
			mode: params.get("mode"),
			vaultPath: params.get("vault_path"),
		};
	} catch {
		return { path: null, mode: null, vaultPath: null };
	}
}
