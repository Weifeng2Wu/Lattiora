import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	addVisualDraft,
	clearVisualDrafts,
	consumeVisualDrafts,
	currentVisualDrafts,
	groupVisualDraftsByPaper,
	removeVisualDraft,
	updateVisualDraftComment,
	visualContextStore,
} from "@/lib/agent/visual-context-store";
import {
	beginTraceContinue,
	buildChatLinesFromVisualTrace,
	buildVisualAnnotationsPrompt,
	buildVisualTraceContinuePrompt,
	buildVisualTraceHistoryItem,
	bytesToBase64,
	completeTrace,
	createNoteTrace,
	createRunningTraces,
	deletePdfVisualTrace,
	failTrace,
	isLegacyVisualMarkRaw,
	isVisualTraceSessionPending,
	loadPdfVisualTraceImage,
	normalizeVisualTraceImagePath,
	parsePdfVisualSessionTrace,
	preparePdfVisualTraceImageWrite,
	readPdfVisualTrace,
	reconcileOrphanRunningVisualTraces,
	rememberPendingVisualTraces,
	resetPendingVisualTracesForTests,
	serializePdfVisualSessionTrace,
	takePendingVisualTraces,
	traceMessages,
	traceMessagesForEmbed,
	tracePin,
	tracePreview,
	visualTraceHistoryId,
	writePdfVisualTrace,
} from "@/lib/pdf/agent-trace";

const rect = { x: 0.1, y: 0.2, w: 0.4, h: 0.15 };
const image = { data: "aaa", mimeType: "image/png" };

describe("visual-context-store", () => {
	beforeEach(() => {
		visualContextStore.setState({ drafts: [] });
	});

	it("adds, updates, removes, and consumes drafts", () => {
		const a = addVisualDraft({
			paperPath: "papers/a",
			page: 2,
			rects: [rect],
			comment: "  λ 是什么  ",
			image,
		});
		const b = addVisualDraft({
			paperPath: "papers/a",
			page: 3,
			rects: [rect],
			comment: "比较曲线",
			image,
		});
		expect(currentVisualDrafts()).toHaveLength(2);
		expect(a.comment).toBe("λ 是什么");

		expect(updateVisualDraftComment(a.id, "  updated  ")).toBe(true);
		expect(currentVisualDrafts()[0]?.comment).toBe("updated");

		removeVisualDraft(b.id);
		expect(currentVisualDrafts().map((d) => d.id)).toEqual([a.id]);

		const consumed = consumeVisualDrafts();
		expect(consumed).toHaveLength(1);
		expect(currentVisualDrafts()).toHaveLength(0);
	});

	it("clearVisualDrafts drops without returning items", () => {
		addVisualDraft({
			paperPath: "papers/a",
			page: 1,
			rects: [rect],
			comment: "x",
			image,
		});
		clearVisualDrafts();
		expect(currentVisualDrafts()).toEqual([]);
	});

	it("assigns unique stable ids (not sequential vis-N filenames)", () => {
		const a = addVisualDraft({
			paperPath: "papers/a",
			page: 1,
			rects: [rect],
			comment: "a",
			image,
		});
		const b = addVisualDraft({
			paperPath: "papers/a",
			page: 2,
			rects: [rect],
			comment: "b",
			image,
		});
		expect(a.id).not.toBe(b.id);
		expect(a.id).not.toMatch(/^vis-\d+$/);
		expect(b.id).not.toMatch(/^vis-\d+$/);
		// Explicit id still wins (Cmd+Enter provisional path).
		const c = addVisualDraft({
			id: "custom-id",
			paperPath: "papers/a",
			page: 3,
			rects: [rect],
			comment: "c",
			image,
		});
		expect(c.id).toBe("custom-id");
	});

	it("keeps one entry per mark id when the same crop is re-added", () => {
		// "Add to sidebar chat" passes the mark id, so a second click on the same
		// comment card must refresh the queued entry, not stack an identical chip
		// that shares its React key and gets removed along with it.
		addVisualDraft({
			id: "mark-a",
			paperPath: "papers/a",
			page: 2,
			rects: [rect],
			comment: "第一次",
			image,
		});
		addVisualDraft({
			id: "mark-b",
			paperPath: "papers/a",
			page: 4,
			rects: [rect],
			comment: "另一处",
			image,
		});
		addVisualDraft({
			id: "mark-a",
			paperPath: "papers/a",
			page: 2,
			rects: [rect],
			comment: "改过的备注",
			image,
		});
		expect(currentVisualDrafts().map((d) => d.id)).toEqual([
			"mark-a",
			"mark-b",
		]);
		// Re-adding refreshes in place — the later note wins.
		expect(currentVisualDrafts()[0]?.comment).toBe("改过的备注");

		removeVisualDraft("mark-a");
		expect(currentVisualDrafts().map((d) => d.id)).toEqual(["mark-b"]);
	});

	it("groups drafts by paper path", () => {
		addVisualDraft({
			paperPath: "papers/a",
			page: 1,
			rects: [rect],
			comment: "a1",
			image,
		});
		addVisualDraft({
			paperPath: "papers/b",
			page: 1,
			rects: [rect],
			comment: "b1",
			image,
		});
		addVisualDraft({
			paperPath: "papers/a",
			page: 2,
			rects: [rect],
			comment: "a2",
			image,
		});
		const groups = groupVisualDraftsByPaper(currentVisualDrafts());
		expect([...groups.keys()].sort()).toEqual(["papers/a", "papers/b"]);
		expect(groups.get("papers/a")).toHaveLength(2);
		expect(groups.get("papers/b")).toHaveLength(1);
	});
});

describe("visual annotations prompt", () => {
	it("requires per-annotation headings and ordered comments", () => {
		const prompt = buildVisualAnnotationsPrompt([
			{ page: 3, comment: "这条公式里的 λ 起什么作用？" },
			{ page: 5, comment: "比较红线和蓝线的差异。" },
		]);
		expect(prompt).toContain("## Annotation 1");
		expect(prompt).toContain("## Annotation 2");
		expect(prompt).toContain("Answer every annotation separately");
		expect(prompt).toContain("Annotation 1 — page 3");
		expect(prompt).toContain("User comment: 这条公式里的 λ 起什么作用？");
		expect(prompt).toContain("Annotation 2 — page 5");
		expect(prompt).toContain("User comment: 比较红线和蓝线的差异。");
		expect(prompt.indexOf("## Annotation 1")).toBeLessThan(
			prompt.indexOf("## Annotation 2"),
		);
	});
});

describe("agent-trace schema and lifecycle", () => {
	it("parses a valid legacy v1 mark into visual v2", () => {
		const raw = {
			version: 1,
			kind: "agent-trace",
			id: "tr1",
			paperPath: "papers/1706.03762",
			index: 1,
			page: 3,
			rects: [rect],
			comment: "λ 是什么",
			image: { path: "assets/tr1.png", mimeType: "image/png" },
			agentId: "agent-1",
			runtimeSessionId: "sess-rt",
			messageId: "msg-1",
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		expect(isLegacyVisualMarkRaw(raw)).toBe(true);
		const t = parsePdfVisualSessionTrace(raw);
		expect(t).not.toBeNull();
		if (!t) return;
		expect(t.kind).toBe("visual");
		expect(t.version).toBe(2);
		expect(t.agent?.agentId).toBe("agent-1");
		expect(t.agent?.index).toBe(1);
		expect(t.comment).toBe("λ 是什么");
		expect(t.image?.path).toBe("assets/tr1.png");
		expect(tracePreview(t)).toContain("λ");
		const pin = tracePin(t);
		expect(pin.x).toBeGreaterThan(0.3);
		expect(pin.y).toBeCloseTo(0.275, 2);
		const disk = serializePdfVisualSessionTrace(t);
		expect(disk.kind).toBe("visual");
		expect(disk.agent).toMatchObject({ agentId: "agent-1", status: "running" });
		expect(disk).not.toHaveProperty("agentId");
	});

	it("parses note-only visual v2 marks without agent", () => {
		const note = createNoteTrace({
			paperPath: "papers/a",
			page: 2,
			rects: [rect],
			comment: "  值得注意  ",
			image,
		});
		expect(note.kind).toBe("visual");
		expect(note.agent).toBeUndefined();
		expect(note.comment).toBe("值得注意");
		const disk = serializePdfVisualSessionTrace(note);
		const again = parsePdfVisualSessionTrace(disk);
		expect(again?.comment).toBe("值得注意");
		expect(again?.agent).toBeUndefined();
		// Empty comment is OK when a crop image is present.
		const bare = createNoteTrace({
			paperPath: "p",
			page: 1,
			rects: [rect],
			comment: "  ",
			image,
		});
		expect(bare.comment).toBe("");
		expect(bare.image?.data).toBe("aaa");
		expect(() =>
			createNoteTrace({
				paperPath: "p",
				page: 1,
				rects: [rect],
				comment: "  ",
			}),
		).toThrow(/comment or crop/i);
	});

	it("rejects empty comment without agent", () => {
		expect(
			parsePdfVisualSessionTrace({
				version: 2,
				kind: "visual",
				id: "empty",
				paperPath: "p",
				page: 1,
				rects: [rect],
				comment: "",
				createdAt: "t",
				updatedAt: "t",
			}),
		).toBeNull();
	});

	it("rejects inline image data in persisted marks", () => {
		const trace = parsePdfVisualSessionTrace({
			version: 1,
			kind: "agent-trace",
			id: "inline",
			paperPath: "papers/a",
			page: 1,
			rects: [rect],
			comment: "inline",
			image: { data: "abc", mimeType: "image/png" },
			agentId: "a",
			runtimeSessionId: "r",
			messageId: "m",
			status: "completed",
			createdAt: "t1",
			updatedAt: "t2",
		});
		expect(trace?.image).toBeUndefined();
	});

	it("normalizes mark-owned image paths", () => {
		expect(normalizeVisualTraceImagePath("./assets/a.png")).toBe(
			"assets/a.png",
		);
		expect(normalizeVisualTraceImagePath("assets\\a.png")).toBe("assets/a.png");
		expect(normalizeVisualTraceImagePath("assets/nested/a.png")).toBeNull();
		expect(normalizeVisualTraceImagePath("../a.png")).toBeNull();
	});

	it("loads inline runtime crops and degrades when an asset is missing", async () => {
		await expect(
			loadPdfVisualTraceImage("/vault/papers/a", {
				data: "YWJj",
				mimeType: "image/png",
			}),
		).resolves.toEqual({ data: "YWJj", mimeType: "image/png" });
		await expect(
			loadPdfVisualTraceImage("/vault/papers/a", {
				path: "assets/missing.png",
				mimeType: "image/png",
			}),
		).resolves.toBeNull();
	});

	it("deletes visual traces through the lifecycle wrapper", async () => {
		const [trace] = createRunningTraces({
			paperPath: "papers/delete",
			agentId: "a",
			runtimeSessionId: "r",
			messageId: "m",
			items: [{ id: "delete-me", page: 1, rects: [rect], comment: "q", image }],
		});
		expect(trace).toBeDefined();
		if (!trace) return;
		await writePdfVisualTrace("/cloud/papers/delete", trace);
		expect(
			await readPdfVisualTrace("/cloud/papers/delete", trace.id),
		).not.toBeNull();
		await deletePdfVisualTrace("/cloud/papers/delete", trace.id);
		expect(
			await readPdfVisualTrace("/cloud/papers/delete", trace.id),
		).toBeNull();
	});

	it("rejects wrong kind or missing geometry", () => {
		expect(
			parsePdfVisualSessionTrace({
				version: 1,
				kind: "ask",
				id: "x",
			}),
		).toBeNull();
		expect(
			parsePdfVisualSessionTrace({
				version: 1,
				kind: "agent-trace",
				id: "x",
				paperPath: "p",
				page: 1,
				rects: [],
				comment: "c",
				agentId: "a",
				runtimeSessionId: "r",
				messageId: "m",
				status: "running",
				createdAt: "t",
				updatedAt: "t",
			}),
		).toBeNull();
	});

	it("Cmd+Enter path keeps comment empty and seeds messages only", () => {
		// Direct chat: conversation text must not also fill mark.comment
		// (wiki embeds would show the same string twice).
		const [mark] = createRunningTraces({
			paperPath: "papers/a",
			agentId: "agent-1",
			runtimeSessionId: "rt-1",
			messageId: "msg-1",
			items: [
				{
					page: 1,
					rects: [rect],
					comment: "",
					image,
					messages: [
						{
							id: "u1",
							role: "user",
							content: "解释这个公式",
							createdAt: "t0",
						},
					],
				},
			],
		});
		expect(mark?.comment).toBe("");
		expect(mark?.agent?.messages?.[0]?.content).toBe("解释这个公式");
		expect(mark?.image?.data).toBe("aaa");
		const disk = serializePdfVisualSessionTrace(mark!);
		expect(disk.comment).toBe("");
		const again = parsePdfVisualSessionTrace(disk);
		expect(again?.comment).toBe("");
		expect(again?.agent?.messages?.[0]?.content).toBe("解释这个公式");
	});

	it("creates one mark per crop and updates completed/failed", () => {
		const marks = createRunningTraces({
			paperPath: "papers/a",
			agentId: "agent-1",
			runtimeSessionId: "rt-1",
			messageId: "msg-1",
			items: [
				{ page: 1, rects: [rect], comment: "first", image },
				{ page: 2, rects: [rect], comment: "second", image },
			],
		});
		expect(marks).toHaveLength(2);
		expect(marks[0]?.agent?.index).toBe(1);
		expect(marks[1]?.agent?.index).toBe(2);
		expect(marks[0]?.id).not.toBe(marks[1]?.id);
		expect(marks[0]?.agent?.runtimeSessionId).toBe(
			marks[1]?.agent?.runtimeSessionId,
		);
		expect(marks[0]?.image?.data).toBe("aaa");
		// Seeded user turn for pin hover message list.
		expect(marks[0]?.agent?.messages?.[0]?.role).toBe("user");
		expect(marks[0]?.agent?.messages?.[0]?.content).toBe("first");

		const first = marks[0];
		const second = marks[1];
		expect(first && second).toBeTruthy();
		if (!first || !second) return;
		const completed = completeTrace(first, {
			providerSessionId: "prov-1",
			answerSnapshot: "## Annotation 1\nok",
			sources: ["uri:1"],
		});
		expect(completed.agent?.status).toBe("completed");
		expect(completed.agent?.providerSessionId).toBe("prov-1");
		expect(completed.agent?.messages?.some((m) => m.role === "assistant")).toBe(
			true,
		);

		const failed = failTrace(second, { error: "timeout" });
		expect(failed.agent?.status).toBe("failed");
		expect(failed.agent?.error).toBe("timeout");
		// First user seed must survive failure (multi-turn continue).
		expect(failed.agent?.messages?.map((m) => m.content)).toEqual(["second"]);
	});

	it("failTrace keeps prior turns and only drops empty assistant bubble", () => {
		const [base] = createRunningTraces({
			paperPath: "papers/a",
			agentId: "agent-1",
			runtimeSessionId: "rt-1",
			messageId: "msg-1",
			items: [{ page: 1, rects: [rect], comment: "first", image }],
		});
		expect(base).toBeDefined();
		if (!base) return;
		const withReply = completeTrace(base, {
			answerSnapshot: "answer one",
			assistantMessageId: "asst-1",
		});
		// Simulate continue: user2 + empty streaming assistant.
		const mid = {
			...withReply,
			agent: {
				...withReply.agent!,
				status: "running" as const,
				messages: [
					...(withReply.agent?.messages ?? []),
					{
						id: "user-2",
						role: "user" as const,
						content: "follow up",
						createdAt: "2026-01-01T00:02:00.000Z",
					},
					{
						id: "asst-2",
						role: "assistant" as const,
						content: "",
						createdAt: "2026-01-01T00:02:01.000Z",
					},
				],
			},
		};
		const failed = failTrace(mid, {
			error: "resume_session: Method not found",
			providerSessionId: "prov-cancelled",
			assistantMessageId: "asst-2",
		});
		expect(failed.agent?.messages?.map((m) => m.content)).toEqual([
			"first",
			"answer one",
			"follow up",
		]);
		expect(failed.agent?.error).toContain("resume_session");
		expect(failed.agent?.providerSessionId).toBe("prov-cancelled");
	});

	it("beginTraceContinue rebinds runtime id and appends user turn", () => {
		const [base] = createRunningTraces({
			paperPath: "papers/a",
			agentId: "agent-1",
			runtimeSessionId: "rt-1",
			messageId: "msg-1",
			items: [{ page: 1, rects: [rect], comment: "first", image }],
		});
		expect(base).toBeDefined();
		if (!base) return;
		const completed = completeTrace(base, {
			providerSessionId: "prov-1",
			answerSnapshot: "answer one",
		});
		const cont = beginTraceContinue(completed, {
			runtimeSessionId: "rt-2",
			messageId: "msg-2",
			userContent: "follow up",
			userMessageId: "user-2",
		});
		expect(cont.agent?.status).toBe("running");
		expect(cont.agent?.runtimeSessionId).toBe("rt-2");
		expect(cont.agent?.messageId).toBe("msg-2");
		expect(cont.agent?.error).toBeUndefined();
		expect(cont.agent?.messages?.map((m) => m.content)).toEqual([
			"first",
			"answer one",
			"follow up",
		]);
		// Second complete should grow the on-disk transcript.
		const done = completeTrace(cont, {
			providerSessionId: "prov-1",
			answerSnapshot: "answer two",
		});
		expect(done.agent?.status).toBe("completed");
		expect(done.agent?.answerSnapshot).toBe("answer two");
		expect(done.agent?.messages?.map((m) => m.content)).toEqual([
			"first",
			"answer one",
			"follow up",
			"answer two",
		]);
		// Idempotent: same trailing user content is not duplicated.
		const again = beginTraceContinue(cont, {
			runtimeSessionId: "rt-3",
			userContent: "follow up",
		});
		expect(
			again.agent?.messages?.filter((m) => m.content === "follow up"),
		).toHaveLength(1);
	});

	it("continue prompt embeds history without requiring session resume", () => {
		const prompt = buildVisualTraceContinuePrompt({
			page: 3,
			comment: "first",
			messages: [
				{
					id: "u1",
					role: "user",
					content: "first",
					createdAt: "t1",
				},
				{
					id: "a1",
					role: "assistant",
					content: "answer one",
					createdAt: "t2",
				},
				{
					id: "u2",
					role: "user",
					content: "follow up",
					createdAt: "t3",
				},
			],
			latestUserQuestion: "follow up",
		});
		expect(prompt).toContain("Earlier turns");
		expect(prompt).toContain("answer one");
		expect(prompt).toContain("follow up");
		expect(prompt).toContain("Page: 3");
	});

	it("externalizes create → complete before persisted parse", () => {
		const [running] = createRunningTraces({
			paperPath: "papers/x",
			agentId: "a",
			runtimeSessionId: "r",
			messageId: "m",
			items: [
				{
					id: "fixed-id",
					page: 4,
					rects: [rect],
					comment: "q",
					image,
				},
			],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(running).toBeDefined();
		if (!running) return;
		const completed = completeTrace(running, {
			providerSessionId: "p",
			answerSnapshot: "answer",
			updatedAt: "2026-01-01T00:01:00.000Z",
		});
		const prepared = preparePdfVisualTraceImageWrite({
			...completed,
			image: { data: "YWJj", mimeType: "image/png" },
		});
		expect(prepared.trace.image).toEqual({
			path: "assets/fixed-id.png",
			mimeType: "image/png",
		});
		expect(prepared.asset?.path).toBe("assets/fixed-id.png");
		expect(bytesToBase64(prepared.asset?.bytes ?? new Uint8Array())).toBe(
			"YWJj",
		);
		expect(JSON.stringify(prepared.trace)).not.toContain('"data"');
		const parsed = parsePdfVisualSessionTrace(
			JSON.parse(JSON.stringify(prepared.trace)),
		);
		expect(parsed).toEqual(prepared.trace);
	});

	it("synthesizes messages from comment + answerSnapshot for legacy marks", () => {
		const raw = {
			version: 1,
			kind: "agent-trace",
			id: "legacy",
			paperPath: "papers/a",
			index: 1,
			page: 2,
			rects: [rect],
			comment: "what is λ?",
			agentId: "a",
			runtimeSessionId: "r",
			messageId: "m",
			status: "completed",
			answerSnapshot: "λ is the learning rate.",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:01:00.000Z",
		};
		const t = parsePdfVisualSessionTrace(raw);
		expect(t).not.toBeNull();
		if (!t) return;
		expect(t.agent?.messages).toBeUndefined();
		const msgs = traceMessages(t);
		expect(msgs).toHaveLength(2);
		expect(msgs[0]?.role).toBe("user");
		expect(msgs[0]?.content).toBe("what is λ?");
		expect(msgs[1]?.role).toBe("assistant");
		expect(msgs[1]?.content).toContain("learning rate");
		// Embed: note stays in comment; only assistant answer is conversation.
		const embedMsgs = traceMessagesForEmbed(t);
		expect(embedMsgs).toHaveLength(1);
		expect(embedMsgs[0]?.role).toBe("assistant");
		expect(embedMsgs[0]?.content).toContain("learning rate");
	});

	it("embed messages omit note-only marks and de-dupe legacy user=comment", () => {
		const noteOnly = createNoteTrace({
			paperPath: "papers/a",
			page: 1,
			rects: [rect],
			comment: "值得注意",
			image,
		});
		expect(traceMessagesForEmbed(noteOnly)).toEqual([]);

		const [running] = createRunningTraces({
			paperPath: "papers/a",
			agentId: "a",
			runtimeSessionId: "r",
			messageId: "m",
			items: [
				{
					page: 1,
					rects: [rect],
					// Legacy path: same string in note + first user turn.
					comment: "explain",
					image,
					messages: [
						{
							id: "u1",
							role: "user",
							content: "explain",
							createdAt: "t0",
						},
						{
							id: "a1",
							role: "assistant",
							content: "ok",
							createdAt: "t1",
						},
					],
				},
			],
		});
		expect(running).toBeDefined();
		if (!running) return;
		const embed = traceMessagesForEmbed(running);
		expect(embed.map((m) => m.role)).toEqual(["assistant"]);
		expect(embed[0]?.content).toBe("ok");

		// Cmd+Enter: empty note, conversation user turn stays.
		const [sendNow] = createRunningTraces({
			paperPath: "papers/a",
			agentId: "a",
			runtimeSessionId: "r",
			messageId: "m",
			items: [
				{
					page: 1,
					rects: [rect],
					comment: "",
					image,
					messages: [
						{
							id: "u1",
							role: "user",
							content: "what is this figure?",
							createdAt: "t0",
						},
					],
				},
			],
		});
		expect(traceMessagesForEmbed(sendNow!).map((m) => m.content)).toEqual([
			"what is this figure?",
		]);
	});

	it("builds continue prompt with history", () => {
		const prompt = buildVisualTraceContinuePrompt({
			page: 3,
			comment: "explain the figure",
			messages: [
				{
					id: "u1",
					role: "user",
					content: "explain the figure",
					createdAt: "t1",
				},
				{
					id: "a1",
					role: "assistant",
					content: "It shows accuracy.",
					createdAt: "t2",
				},
				{
					id: "u2",
					role: "user",
					content: "What about the blue line?",
					createdAt: "t3",
				},
			],
			latestUserQuestion: "What about the blue line?",
		});
		expect(prompt).toContain("Page: 3");
		expect(prompt).toContain("Original annotation comment: explain the figure");
		expect(prompt).toContain("Assistant: It shows accuracy.");
		expect(prompt).toContain("What about the blue line?");
	});

	it("builds Open-in-Agent lines with multi-turn + image chip", () => {
		const messages = [
			{
				id: "u1",
				role: "user" as const,
				content: "这里最值得读的是什么?",
				createdAt: "t1",
			},
			{
				id: "a1",
				role: "assistant" as const,
				content: "方法段落。",
				createdAt: "t2",
			},
			{
				id: "u2",
				role: "user" as const,
				content: "还有呢?",
				createdAt: "t3",
			},
			{
				id: "a2",
				role: "assistant" as const,
				content: "实验设置。",
				createdAt: "t4",
			},
		];
		const lines = buildChatLinesFromVisualTrace({
			traceId: "tr1",
			page: 2,
			comment: "这里最值得读的是什么?",
			paperPath: "papers/a",
			image,
			messages,
		});
		expect(lines).toHaveLength(4);
		expect(lines[0]).toMatchObject({
			kind: "user",
			text: "这里最值得读的是什么?",
		});
		if (lines[0]?.kind === "user") {
			expect(lines[0].visualAnnotations).toHaveLength(1);
			expect(lines[0].visualAnnotations?.[0]?.image.data).toBe("aaa");
			expect(lines[0].visualAnnotations?.[0]?.page).toBe(2);
		}
		// Chip only on first user turn.
		if (lines[2]?.kind === "user") {
			expect(lines[2].visualAnnotations).toBeUndefined();
		}
		const history = buildVisualTraceHistoryItem({
			trace: {
				id: "tr1",
				page: 2,
				comment: "这里最值得读的是什么?",
				paperPath: "papers/a",
				image,
				agent: {
					agentId: "agent-1",
					runtimeSessionId: "rt-last",
					messageId: "m1",
					providerSessionId: "prov",
					status: "completed",
					messages,
				},
			},
			messages,
			title: "这里最值得读的是什么?",
			agentName: "Agent",
			startedAt: "now",
			paperAbsPath: "/vault/papers/a",
		});
		expect(history.id).toBe(visualTraceHistoryId("tr1"));
		expect(history.lines).toHaveLength(4);
		expect(history.id).not.toBe("rt-last");
		expect(history.resumeable).toBe(true);
		expect(history.providerSessionId).toBe("prov");
		expect(history.visualTraceId).toBe("tr1");
		expect(history.paperAbsPath).toBe("/vault/papers/a");
	});
});

describe("pending visual traces lifecycle", () => {
	beforeEach(() => {
		resetPendingVisualTracesForTests();
	});

	it("remembers and takes writes by runtime session", () => {
		rememberPendingVisualTraces("rt-1", [
			{ paperAbsPath: "/p/a", traceId: "t1" },
		]);
		rememberPendingVisualTraces("rt-1", [
			{ paperAbsPath: "/p/a", traceId: "t2" },
		]);
		expect(isVisualTraceSessionPending("rt-1")).toBe(true);
		const taken = takePendingVisualTraces("rt-1");
		expect(taken).toEqual([
			{ paperAbsPath: "/p/a", traceId: "t1" },
			{ paperAbsPath: "/p/a", traceId: "t2" },
		]);
		// Grace window keeps the session "pending" so list reconcile cannot race.
		expect(isVisualTraceSessionPending("rt-1")).toBe(true);
		expect(takePendingVisualTraces("rt-1")).toEqual([]);
	});

	it("reconciles orphan running marks but keeps in-flight sessions", async () => {
		const [orphan, active] = createRunningTraces({
			paperPath: "papers/a",
			agentId: "a",
			runtimeSessionId: "rt-orphan",
			messageId: "m1",
			items: [
				{ page: 1, rects: [rect], comment: "orphan", image },
				{ page: 2, rects: [rect], comment: "active", image },
			],
		});
		expect(orphan && active).toBeTruthy();
		if (!orphan || !active) return;
		const activeRunning = {
			...active,
			id: "active-id",
			agent: {
				...active.agent!,
				runtimeSessionId: "rt-active",
			},
		};
		rememberPendingVisualTraces("rt-active", [
			{ paperAbsPath: "/vault/papers/a", traceId: activeRunning.id },
		]);

		const reconciled = await reconcileOrphanRunningVisualTraces(
			"/vault/papers/a",
			[orphan, activeRunning],
		);
		expect(reconciled).toHaveLength(2);
		expect(reconciled[0]?.agent?.status).toBe("failed");
		expect(reconciled[0]?.agent?.error).toMatch(/interrupted/i);
		// User seed survives fail.
		expect(reconciled[0]?.agent?.messages?.[0]?.content).toBe("orphan");
		expect(reconciled[1]?.agent?.status).toBe("running");
		expect(reconciled[1]?.id).toBe("active-id");
	});

	it("does not fail a mark right after take (finalize grace)", async () => {
		const [running] = createRunningTraces({
			paperPath: "papers/a",
			agentId: "a",
			runtimeSessionId: "rt-fin",
			messageId: "m",
			items: [{ page: 1, rects: [rect], comment: "finishing", image }],
		});
		expect(running).toBeDefined();
		if (!running) return;
		rememberPendingVisualTraces("rt-fin", [
			{ paperAbsPath: "/p", traceId: running.id },
		]);
		takePendingVisualTraces("rt-fin");
		const reconciled = await reconcileOrphanRunningVisualTraces("/p", [
			running,
		]);
		expect(reconciled[0]?.agent?.status).toBe("running");
	});
});

beforeEach(() => {
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: {
			request: async (_name: string, action: () => Promise<unknown>) =>
				action(),
		},
	});
});
afterEach(() => vi.unstubAllGlobals());
