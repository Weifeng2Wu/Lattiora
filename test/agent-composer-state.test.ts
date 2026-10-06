import { describe, expect, it } from "vitest";
import {
	type AgentComposerState,
	clearSubmittedComposerState,
	composerScopeKey,
	loadAgentComposerState,
	removeAgentComposerState,
	saveAgentComposerState,
} from "@/lib/agent/composer-state";

class MemoryStorage {
	private values = new Map<string, string>();

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}

	onlyKey() {
		return [...this.values.keys()][0];
	}
}

const state: AgentComposerState = {
	text: "continue reviewing",
	mentionedPaths: ["notes/a.md"],
	selectedSkillIds: ["review"],
	includeSelectedFile: true,
};

describe("agent Composer persistence", () => {
	it("isolates state by Vault, Agent, and session", () => {
		const storage = new MemoryStorage();
		const firstScope = composerScopeKey("/vault-a", "codex");
		const secondScope = composerScopeKey("/vault-a", "claude");
		expect(firstScope).not.toBeNull();
		expect(secondScope).not.toBeNull();
		if (!firstScope || !secondScope) return;

		saveAgentComposerState(storage, firstScope, "session-a", state);

		expect(loadAgentComposerState(storage, firstScope, "session-a")).toEqual(
			state,
		);
		expect(loadAgentComposerState(storage, firstScope, "session-b")).toBeNull();
		expect(
			loadAgentComposerState(storage, secondScope, "session-a"),
		).toBeNull();
	});

	it("removes only the requested session", () => {
		const storage = new MemoryStorage();
		const scope = composerScopeKey("/vault", "codex");
		expect(scope).not.toBeNull();
		if (!scope) return;

		saveAgentComposerState(storage, scope, "draft", state);
		saveAgentComposerState(storage, scope, "session-a", {
			...state,
			text: "next prompt",
		});
		removeAgentComposerState(storage, scope, "draft");

		expect(loadAgentComposerState(storage, scope, "draft")).toBeNull();
		expect(loadAgentComposerState(storage, scope, "session-a")?.text).toBe(
			"next prompt",
		);
	});

	it("normalizes persisted arrays and malformed fields", () => {
		const storage = new MemoryStorage();
		const scope = composerScopeKey("/vault", "codex");
		expect(scope).not.toBeNull();
		if (!scope) return;

		saveAgentComposerState(storage, scope, "draft", state);
		const key = storage.onlyKey();
		expect(key).toBeDefined();
		if (!key) return;
		storage.setItem(
			key,
			JSON.stringify({
				text: 42,
				mentionedPaths: ["notes/a.md", "notes/a.md", null],
				selectedSkillIds: ["review", "review", false],
				includeSelectedFile: "yes",
			}),
		);

		expect(loadAgentComposerState(storage, scope, "draft")).toEqual({
			text: "",
			mentionedPaths: ["notes/a.md"],
			selectedSkillIds: ["review"],
			includeSelectedFile: false,
		});
	});

	it("clears submitted context while preserving newer edits", () => {
		expect(clearSubmittedComposerState(state, state)).toEqual({
			text: "",
			mentionedPaths: [],
			selectedSkillIds: [],
			// Current paper/file remains attached by default across turns.
			includeSelectedFile: true,
		});

		expect(
			clearSubmittedComposerState(
				{
					...state,
					text: "draft written while the request starts",
					selectedSkillIds: ["review", "summarize"],
					includeSelectedFile: false,
				},
				state,
			),
		).toEqual({
			...state,
			text: "draft written while the request starts",
			mentionedPaths: [],
			selectedSkillIds: ["summarize"],
			includeSelectedFile: false,
		});
	});
});
