/**
 * ⌘K Quick chat registration shared by every selection surface (PDF viewer,
 * plaza feed, proxied web papers, text editor): while the surface's toolbar
 * is armed, the chord opens its in-page Ask. The registration is
 * mount-stable; refs keep it pointed at the latest `isArmed` / `openAsk`,
 * and handlers without a live selection return false so the next registered
 * surface (newest first) can consume the chord.
 */

import { useEffect, useRef } from "react";
import { registerSelectionQuickChat } from "@/lib/agent/selection-quick-chat";

export function useSelectionQuickChat(
	isArmed: () => boolean,
	openAsk: () => void,
): void {
	const isArmedRef = useRef(isArmed);
	isArmedRef.current = isArmed;
	const openAskRef = useRef(openAsk);
	openAskRef.current = openAsk;

	useEffect(() => {
		return registerSelectionQuickChat(() => {
			if (!isArmedRef.current()) return false;
			openAskRef.current();
			return true;
		});
	}, []);
}
