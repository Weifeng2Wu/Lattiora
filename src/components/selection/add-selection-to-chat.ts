/**
 * Add-to-chat tail shared by every selection surface (PDF viewer, plaza
 * feed, proxied web papers, text editor): publish the selection as the live
 * Agent chip, pin it, and focus the Agent rail. Surfaces keep their own
 * dismissal / selection-clearing choreography before calling this.
 */

import {
	type PublishSelectionInput,
	pinActiveSelection,
	publishSelection,
} from "@/lib/agent/selection-store";
import { openRightTab } from "@/lib/shell/ui-window-actions";

export function addSelectionToChat(payload: PublishSelectionInput): void {
	publishSelection(payload);
	pinActiveSelection();
	openRightTab("agent");
}
