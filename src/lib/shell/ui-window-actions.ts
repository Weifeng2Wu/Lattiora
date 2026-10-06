/**
 * Right-rail / feature-window opening actions split from `ui-store`.
 *
 * The store must not import `feature-window` (which reads the store back),
 * so these actions live here: ui-window-actions → feature-window → ui-store.
 */

import {
	type AgentSessionOpenRequest,
	layout,
	openRightTabInRail,
	type RightSidebarTab,
	setLayoutMode,
	uiStore,
} from "@/lib/shell/ui-store";

/** ⌘L — toggle right sidebar (defaults to agent). */
export function toggleChat(): void {
	setLayoutMode("custom");
	const { rightSidebarOpen, rightSidebarTab } = uiStore.getState();
	if (rightSidebarOpen) {
		layout()?.setRightCollapsed(true);
		return;
	}
	void import("@/lib/shell/feature-window").then(
		async ({ preferFeatureWindow }) => {
			if (await preferFeatureWindow(rightSidebarTab)) return;
			layout()?.setRightCollapsed(false, {
				focusAgent: rightSidebarTab === "agent",
			});
		},
	);
}

/**
 * Open a feature view. If its singleton native window is open, focus that
 * window and do not host a second copy in the main right rail (same policy for
 * Agent and Annotations).
 */
export function openRightTab(tab: RightSidebarTab): void {
	setLayoutMode("custom");
	void import("@/lib/shell/feature-window").then(
		async ({ preferFeatureWindow }) => {
			if (await preferFeatureWindow(tab)) return;
			openRightTabInRail(tab);
		},
	);
}

let agentSessionOpenNonce = 0;

/** Request Agent panel to open a runtime/provider session (PDF pin click). */
export function requestOpenAgentSession(
	input: Omit<AgentSessionOpenRequest, "nonce">,
): void {
	agentSessionOpenNonce += 1;
	const request: AgentSessionOpenRequest = {
		...input,
		nonce: agentSessionOpenNonce,
	};
	uiStore.setState({
		agentSessionOpenRequest: request,
	});
	// Always try the agent singleton window first (live probe, not only flag).
	void import("@/lib/shell/feature-window").then(
		async ({ preferFeatureWindow }) => {
			const inWindow = await preferFeatureWindow("agent");
			if (inWindow) {
				const { broadcastAgentOpenSession } = await import(
					"@/lib/shell/workspace-broadcast"
				);
				broadcastAgentOpenSession(request);
				return;
			}
			// Expanding the rail deviates from the active preset — persist it.
			setLayoutMode("custom");
			openRightTabInRail("agent");
		},
	);
}
