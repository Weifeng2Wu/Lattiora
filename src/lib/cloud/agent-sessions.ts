import type {
	AcpHistoryLine,
	AcpListSessionsResult,
	AcpLoadSessionResult,
} from "@/lib/agent/api";
import type { ChatLine } from "@/lib/agent/chat-state";
import type { AgentMessage } from "./agent-protocol";
import {
	cloudRelative,
	listLocalFiles,
	readLocalFile,
	writeLocalFile,
} from "./files";

export type BrowserAgentSession = {
	format: 1;
	title: string;
	updatedAt: number;
	messages: AgentMessage[];
	lines: AcpHistoryLine[];
	hidden?: boolean;
	interrupted?: boolean;
};
const sessionFile = (path: string) =>
	/(?:^|\/)\.agentero\/(?:agent-sessions|chats)\/[^/]+\.json$/.test(path);
export const newSessionPath = () =>
	`.agentero/agent-sessions/${crypto.randomUUID()}.json`;
export function historyLines(lines: ChatLine[]): AcpHistoryLine[] {
	return lines.flatMap((line): AcpHistoryLine[] => {
		if (line.kind === "user") return [{ ...line }];
		if (line.kind === "agent")
			return [
				{
					...line,
					text: line.parts
						.filter((p) => p.type === "text")
						.map((p) => p.text)
						.join(""),
					parts: line.parts,
				},
			];
		return [];
	});
}
export function messagesFromLines(lines: AcpHistoryLine[]): AgentMessage[] {
	return lines.map((line) => ({
		role: line.kind === "user" ? "user" : "assistant",
		content: line.text,
		...(line.images?.length ? { images: line.images } : {}),
	}));
}
export async function readBrowserSession(
	id: string,
): Promise<{ value: BrowserAgentSession; raw: string; path: string }> {
	const path = cloudRelative(id);
	if (!sessionFile(path)) throw new Error("invalidPath");
	const raw = await (await readLocalFile(path)).text();
	const data = JSON.parse(raw);
	if (!Array.isArray(data.messages) || typeof data.title !== "string")
		throw new Error("invalidSession");
	if (data.format === 1) {
		if (!Array.isArray(data.lines)) throw new Error("invalidSession");
		return { value: data, raw, path };
	}
	// Read the preceding Cloudflare version's conversations without deleting or rewriting them.
	const messages: AgentMessage[] = data.messages.map(
		(m: { role: string; content: string; context?: string }) => {
			if (
				!["user", "assistant"].includes(m.role) ||
				typeof m.content !== "string"
			)
				throw new Error("invalidSession");
			return {
				role: m.role as "user" | "assistant",
				content:
					m.content +
					(m.context
						? `\n\n<reference_documents>\n${m.context}\n</reference_documents>`
						: ""),
			};
		},
	);
	const lines: AcpHistoryLine[] = data.messages.map(
		(m: { id?: string; role: string; content: string }) => ({
			id: m.id || crypto.randomUUID(),
			kind: m.role === "user" ? "user" : "agent",
			text: m.content,
		}),
	);
	return {
		path,
		raw,
		value: {
			format: 1,
			title: data.title,
			updatedAt: data.updatedAt || 0,
			messages,
			lines,
		},
	};
}
export async function browserSessionList(): Promise<AcpListSessionsResult> {
	const sessions = [];
	for (const file of await listLocalFiles()) {
		if (file.deleted || !sessionFile(file.path)) continue;
		try {
			const { value } = await readBrowserSession(file.path);
			if (!value.hidden)
				sessions.push({
					sessionId: file.path,
					cwd: "/cloud",
					title: value.title,
					updatedAt: new Date(value.updatedAt).toISOString(),
				});
		} catch {
			/* Malformed/imported or uncached files remain available in export. */
		}
	}
	return {
		supported: true,
		sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
	};
}
export async function browserSessionLoad(
	id: string,
): Promise<AcpLoadSessionResult> {
	const { value } = await readBrowserSession(id);
	return { sessionId: id, title: value.title, lines: value.lines };
}
/** A writer owns its baseline; local or remote edits fork rather than overwrite. */
export function sessionWriter(path: string, initial: string | null) {
	let baseline = initial;
	let queue = Promise.resolve();
	return {
		get path() {
			return path;
		},
		write(value: BrowserAgentSession) {
			const raw = JSON.stringify(value);
			queue = queue.then(async () => {
				try {
					await writeLocalFile(
						path,
						new Blob([raw], { type: "application/json" }),
						{ expectedText: baseline },
					);
				} catch (error) {
					if (!(error instanceof Error) || error.message !== "localConflict")
						throw error;
					path = newSessionPath();
					await writeLocalFile(
						path,
						new Blob([raw], { type: "application/json" }),
						{ expectedText: null },
					);
				}
				baseline = raw;
			});
			return queue;
		},
	};
}
