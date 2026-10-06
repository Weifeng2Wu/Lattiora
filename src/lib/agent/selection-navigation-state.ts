import { createStore } from "zustand/vanilla";
export const selectionNavigationStore = createStore<{
	messageId: string | null;
	tabId: string | null;
	nonce: number;
}>(() => ({ messageId: null, tabId: null, nonce: 0 }));
