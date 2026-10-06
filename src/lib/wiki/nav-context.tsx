import { createContext, useContext } from "react";

import type { WikiNavTarget } from "@/lib/wiki/api";

export type WikiNavContextValue = {
	onWikiNavigate: (nav: WikiNavTarget) => void;
	/** Active Vault root for Host-backed semantic resolution. */
	vaultPath?: string | null;
	/** Vault-relative Markdown, image, and PDF paths used by link rendering. */
	mdFiles?: string[];
};

export const WikiNavContext = createContext<WikiNavContextValue | null>(null);

export function useWikiNav(): WikiNavContextValue | null {
	return useContext(WikiNavContext);
}
