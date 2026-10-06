/**
 * WikiNavContext provider that subscribes to the vault store itself, so tree
 * changes update wiki-link consumers without re-rendering the App shell
 * (children element identity stays stable across provider re-renders).
 */

import { type ReactNode, useMemo } from "react";
import { useVaultStore } from "@/hooks/use-app-stores";
import type { WikiNavTarget } from "@/lib/wiki";
import { WikiNavContext } from "@/lib/wiki/nav-context";
import { navigateWiki } from "@/lib/workspace/actions";

function onWikiNavigate(nav: WikiNavTarget): void {
	void navigateWiki(nav);
}

export function WikiNavProvider({ children }: { children: ReactNode }) {
	const vaultPath = useVaultStore((s) => s.vaultPath);
	const mdFiles = useVaultStore((s) => s.vaultWikiTargetFiles);
	const value = useMemo(
		() => ({ onWikiNavigate, mdFiles, vaultPath }),
		[mdFiles, vaultPath],
	);
	return (
		<WikiNavContext.Provider value={value}>{children}</WikiNavContext.Provider>
	);
}
