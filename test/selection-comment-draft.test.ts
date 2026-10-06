import { beforeEach, describe, expect, it } from "vitest";
import { agentSessionStore } from "@/lib/agent/agent-session-store";
import {
	annotationStore,
	releaseAnnotationAnchor,
} from "@/lib/agent/selection-annotations";
import {
	confirmSelectionChat,
	dismissSelectionChat,
	openAnnotationEditor,
	openSelectionChat,
	selectionChatStore,
	suspendSelectionChat,
	updateSelectionChatComment,
} from "@/lib/agent/selection-chat-store";
import {
	clearSelections,
	currentSelections,
} from "@/lib/agent/selection-store";

const quote = {
	text: "a quote",
	sourcePath: "notes/test.md",
	origin: "markdown" as const,
};
const screen = { x: 100, y: 100 };
beforeEach(() => {
	selectionChatStore.setState({ draft: null, suspended: [] });
	agentSessionStore.setState({ activeTabId: "draft" });
	annotationStore.setState({ binding: null, releasedId: null });
	clearSelections();
});
describe("recoverable comment drafts", () => {
	it("outside dismissal saves text; reopening recovers it, confirmation consumes it", () => {
		openSelectionChat(quote, screen);
		updateSelectionChatComment("unfinished");
		suspendSelectionChat();
		expect(selectionChatStore.getState().draft).toBeNull();
		openSelectionChat(quote, { x: 200, y: 200 }, "menu");
		expect(selectionChatStore.getState().draft).toMatchObject({
			comment: "unfinished",
			stage: "comment",
			screen: { x: 200, y: 200 },
		});
		confirmSelectionChat("finished");
		expect(currentSelections()[0].comment).toBe("finished");
		expect(selectionChatStore.getState().suspended).toEqual([]);
	});
	it("explicit cancel discards only this quote, keeping another suspended draft", () => {
		openSelectionChat(quote, screen);
		updateSelectionChatComment("keep");
		suspendSelectionChat();
		openSelectionChat({ ...quote, text: "other" }, screen);
		updateSelectionChatComment("discard");
		dismissSelectionChat();
		expect(selectionChatStore.getState().suspended).toHaveLength(1);
		openSelectionChat(quote, screen);
		expect(selectionChatStore.getState().draft?.comment).toBe("keep");
		dismissSelectionChat();
		openSelectionChat(quote, screen);
		expect(selectionChatStore.getState().draft?.comment).toBeUndefined();
	});
	it("isolates scratch text by conversation and preserves an intentional empty edit", () => {
		openSelectionChat(quote, screen);
		updateSelectionChatComment("session A");
		agentSessionStore.setState({ activeTabId: "other" });
		openSelectionChat(quote, screen);
		expect(selectionChatStore.getState().draft?.comment).toBeUndefined();
		dismissSelectionChat();
		agentSessionStore.setState({ activeTabId: "draft" });
		openSelectionChat(quote, screen);
		expect(selectionChatStore.getState().draft?.comment).toBe("session A");
		dismissSelectionChat();
		const original = { ...quote, id: "existing", pinned: true, comment: "old" };
		openAnnotationEditor(original, screen);
		updateSelectionChatComment("");
		suspendSelectionChat();
		openAnnotationEditor(original, screen);
		expect(selectionChatStore.getState().draft?.comment).toBe("");
		suspendSelectionChat();
		releaseAnnotationAnchor("existing");
		expect(selectionChatStore.getState().suspended).toEqual([]);
	});
});
