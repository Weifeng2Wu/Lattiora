import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	tabs: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/workspace/store", () => ({
	workspaceStore: { getState: () => state },
}));
vi.mock("@/lib/workspace/text-editor-flush", () => ({
	flushAllTextEditors: async () => true,
}));
vi.mock("@/lib/workspace/actions", () => ({
	applyDiskChange: async () => undefined,
}));
beforeEach(() => {
	vi.resetModules();
	state.tabs = [];
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: {
			request: async (_name: string, fn: () => Promise<unknown>) => fn(),
		},
	});
});
afterEach(() => vi.unstubAllGlobals());
it("preserves newer notes, enforces restricted mode, and executes only approved writes", async () => {
	const files = await import("../src/lib/cloud/files");
	const { executeAgentTool, answerAgentRequest } = await import(
		"../src/lib/cloud/agent-runtime"
	);
	const { listen } = await import("../src/lib/core/browser-events");
	const opts = {
		sessionId: "test",
		signal: new AbortController().signal,
		readOnly: false,
		permissionMode: "auto",
	};
	const call = {
		id: "1",
		name: "write_note",
		arguments: JSON.stringify({
			path: "notes/a.md",
			content: "AI change",
			expectedText: "old",
		}),
	};
	await files.writeLocalFile("notes/a.md", new Blob(["newer user edit"]));
	await expect(executeAgentTool(call, opts)).rejects.toThrow("localConflict");
	await expect(
		executeAgentTool(call, { ...opts, readOnly: true }),
	).rejects.toThrow("permissionDenied");
	call.arguments = JSON.stringify({
		path: "notes/a.md",
		content: "AI change",
		expectedText: "newer user edit",
	});
	const off = await listen<{ requestId: string }>(
		"agent:permission-request",
		(event) => {
			void answerAgentRequest(event.payload.requestId, "permission", null);
		},
	);
	await expect(
		executeAgentTool(call, { ...opts, permissionMode: "ask" }),
	).rejects.toThrow("permissionDenied");
	off();
	expect(await (await files.readLocalFile("notes/a.md")).text()).toBe(
		"newer user edit",
	);
	const allow = await listen<{ requestId: string }>(
		"agent:permission-request",
		(event) => {
			void answerAgentRequest(event.payload.requestId, "permission", "allow");
		},
	);
	await expect(
		executeAgentTool(call, { ...opts, permissionMode: "ask" }),
	).resolves.toMatchObject({ path: "notes/a.md", saved: true });
	allow();
	expect(await (await files.readLocalFile("notes/a.md")).text()).toBe(
		"AI change",
	);
});
it("keeps concurrent session versions and reads legacy chats plus synchronized conflict copies", async () => {
	const files = await import("../src/lib/cloud/files");
	const sessions = await import("../src/lib/cloud/agent-sessions");
	const path = sessions.newSessionPath();
	const base = {
		format: 1 as const,
		title: "History",
		updatedAt: Date.now(),
		messages: [{ role: "user" as const, content: "hello" }],
		lines: [{ id: "u", kind: "user" as const, text: "hello" }],
	};
	const a = sessions.sessionWriter(path, null);
	const b = sessions.sessionWriter(path, null);
	await a.write(base);
	await b.write({ ...base, title: "B branch" });
	expect(b.path).not.toBe(a.path);
	await files.writeLocalFile(
		`Conflicts/remote/${path}`,
		new Blob([JSON.stringify({ ...base, title: "Remote copy" })]),
	);
	await files.writeLocalFile(
		".agentero/chats/legacy.json",
		new Blob([
			JSON.stringify({
				title: "Legacy",
				messages: [{ role: "assistant", content: "old answer" }],
				updatedAt: 1,
			}),
		]),
	);
	expect(
		(await sessions.browserSessionList()).sessions.map((s) => s.title).sort(),
	).toEqual(["B branch", "History", "Legacy", "Remote copy"]);
	expect(
		(await sessions.browserSessionLoad(".agentero/chats/legacy.json")).lines[0]
			.text,
	).toBe("old answer");
});
it("loads the original Skill knowledge and local overrides, with readable attached documents", async () => {
	const files = await import("../src/lib/cloud/files");
	const skills = await import("../src/lib/cloud/skills");
	const { agentDocumentContext } = await import(
		"../src/lib/cloud/agent-documents"
	);
	expect(await skills.vaultInstructions()).toContain("Paper reading order");
	await files.writeLocalFile("AGENTS.md", new Blob(["My vault rules"]));
	expect(await skills.vaultInstructions()).toBe("My vault rules");
	expect((await skills.listSkills()).map((s) => s.id)).toContain(
		"paper-reader",
	);
	expect(await skills.skillInstructions(["paper-reader"])).toContain(
		"Problem & Motivation",
	);
	await files.writeLocalFile(
		".agents/skills/paper-reader/SKILL.md",
		new Blob([
			"---\nname: My reader\ndescription: personal rules\n---\nUse my evidence rubric.",
		]),
	);
	expect(await skills.skillInstructions(["paper-reader"])).toContain(
		"Use my evidence rubric.",
	);
	await files.writeLocalFile(
		"notes/evidence.md",
		new Blob(["Actual document text"]),
	);
	expect(await agentDocumentContext(["/cloud/notes/evidence.md"])).toContain(
		"Actual document text",
	);
	await expect(agentDocumentContext(["notes/missing.md"])).rejects.toThrow(
		"notFound",
	);
});

it("protects unsaved rich notes and preserves reversible writes across reload without clobbering newer edits", async () => {
	const files = await import("../src/lib/cloud/files");
	const edits = await import("../src/lib/cloud/agent-edits");
	await files.writeLocalFile("notes/review.md", new Blob(["before"]));
	state.tabs = [{ path: "/cloud/notes/review.md", markdownDirty: true }];
	await expect(
		edits.writeAgentNote("notes/review.md", "after", "before"),
	).rejects.toThrow("localConflict");
	state.tabs = [
		{
			path: "/cloud/paper.pdf",
			notesPath: "/cloud/notes/review.md",
			notesDirty: true,
		},
	];
	await expect(
		edits.writeAgentNote("notes/review.md", "after", "before"),
	).rejects.toThrow("localConflict");
	state.tabs = [];
	const written = await edits.writeAgentNote(
		"notes/review.md",
		"after",
		"before",
	);
	expect(await edits.readAgentEdit(written.editId)).toMatchObject({
		before: "before",
		status: "pending",
	});
	await files.writeLocalFile("notes/review.md", new Blob(["newer edit"]));
	await expect(
		edits.resolveAgentEdit(written.editId, "reverted"),
	).rejects.toThrow("localConflict");
	expect(await (await files.readLocalFile("notes/review.md")).text()).toBe(
		"newer edit",
	);
	await files.writeLocalFile("notes/review.md", new Blob(["after"]));
	await edits.resolveAgentEdit(written.editId, "reverted");
	expect(await (await files.readLocalFile("notes/review.md")).text()).toBe(
		"before",
	);
	expect((await edits.readAgentEdit(written.editId)).status).toBe("reverted");
	const created = await edits.writeAgentNote("notes/new.md", "new", null);
	await edits.resolveAgentEdit(created.editId, "reverted");
	await expect(files.readLocalFile("notes/new.md")).rejects.toThrow(
		"File not found",
	);
	const kept = await edits.writeAgentNote("notes/keep.md", "keep", null);
	await edits.resolveAgentEdit(kept.editId, "kept");
	await edits.resolveAgentEdit(kept.editId, "reverted");
	expect(await (await files.readLocalFile("notes/keep.md")).text()).toBe(
		"keep",
	);
});

it("answers structured questions, resumes tool history, and checkpoints cancellation without executing later writes", async () => {
	const runtime = await import("../src/lib/cloud/agent-runtime");
	const { listen } = await import("../src/lib/core/browser-events");
	const sessions = await import("../src/lib/cloud/agent-sessions");
	const requests: any[] = [];
	let mode = "ask";
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		const request = JSON.parse(init.body as string);
		requests.push(request);
		const events =
			mode === "ask" || mode === "cancel"
				? [
						{
							type: "tool_call",
							call: {
								id: "question",
								name: "ask_user",
								arguments: JSON.stringify({
									question: "Which evidence?",
									options: ["Paper A", "Paper B"],
								}),
							},
						},
						{ type: "done", reason: "tool_calls" },
					]
				: [
						{ type: "delta", text: "Evidence answer" },
						{ type: "done", reason: "stop" },
					];
		return new Response(
			events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
		);
	});
	const completed = new Promise<{ providerSessionId: string }>((resolve) => {
		void listen<any>("agent:completed", (event) => resolve(event.payload));
	});
	const offAsk = await listen<any>("agent:ask-user-request", (event) => {
		mode = "answer";
		void runtime.answerAgentRequest(event.payload.requestId, "ask", {
			answers: ["Paper B"],
		});
	});
	await runtime.runBrowserAgent({
		prompt: "Find evidence",
		permissionMode: "restricted",
	});
	const first = await completed;
	offAsk();
	expect(requests[1].messages.at(-1)).toMatchObject({
		role: "tool",
		content: '{"answers":["Paper B"]}',
	});
	expect(
		(await sessions.readBrowserSession(first.providerSessionId)).value
			.interrupted,
	).toBe(false);
	mode = "cancel";
	let cancelledRequest = "";
	const failed = new Promise<void>((resolve) => {
		void listen("agent:failed", () => resolve());
	});
	const offCancel = await listen<any>("agent:ask-user-request", (event) => {
		cancelledRequest = event.payload.requestId;
		void runtime.cancelBrowserRun(event.payload.sessionId);
	});
	await runtime.runBrowserAgent({
		prompt: "Follow up",
		sessionId: first.providerSessionId,
	});
	await failed;
	offCancel();
	expect(
		requests[2].messages.some((m: any) => m.content === "Evidence answer"),
	).toBe(true);
	const interrupted = (
		await sessions.readBrowserSession(first.providerSessionId)
	).value;
	expect(interrupted.interrupted).toBe(true);
	expect(interrupted.messages.at(-1)).toMatchObject({
		role: "tool",
		content: '{"error":"cancelled"}',
	});
	await expect(
		runtime.answerAgentRequest(cancelledRequest, "ask", {}),
	).rejects.toThrow("requestExpired");
}, 15000);
