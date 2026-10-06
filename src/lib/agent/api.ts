import i18n from "@/i18n";
import { events } from "@/lib/core/bindings";
import type { UnlistenFn } from "@/lib/core/browser-events";
import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";
import { loadSettings } from "@/lib/settings";
import type { CatalogAcpStatus, CatalogEntry } from "./api-types";

export type {
	AcpSessionCapabilities,
	CatalogAcpStatus,
	CatalogEntry,
	ProbeResult,
} from "./api-types";

export type AgentTemplate =
	| "opencode"
	| "openclaw"
	| "hermes"
	| "claude-acp"
	| "codex-acp"
	| "antigravity-acp"
	| "qodercli"
	| "grok-build"
	| "pi"
	| "dsh"
	| "kimi-code"
	| "zcode"
	| "minimax-code"
	| "custom";

export type AgentDescriptor = {
	id: string;
	name: string;
	template: AgentTemplate;
	command: string;
	args: string[];
	env: Record<string, string>;
	available: boolean;
	lastError?: string | null;
	lastProbeOk?: boolean | null;
	lastProbeAgentName?: string | null;
	lastProbeError?: string | null;
	lastProbedAt?: string | null;
};

export type AgentListResponse = {
	agents: AgentDescriptor[];
	defaultId: string | null;
	enabled: boolean;
};

export type CatalogScanResponse = {
	entries: CatalogEntry[];
	customAgents: AgentDescriptor[];
	defaultId: string | null;
	enabled: boolean;
	proxyEnabled: boolean;
	proxyUrl: string;
	/** Optional ACP/Codex HTTP User-Agent override (empty = off). */
	userAgent?: string;
	/** Comma-separated Codex model_providers ids for http_headers injection. */
	userAgentProviderIds?: string;
};

export type AcpSessionInfo = {
	sessionId: string;
	cwd: string;
	title?: string | null;
	updatedAt?: string | null;
};

export type AcpListSessionsResult = {
	sessions: AcpSessionInfo[];
	nextCursor?: string | null;
	supported: boolean;
};

export type PromptImage = {
	/** Raw base64 without data: prefix */
	data: string;
	mimeType: string;
};

export type AcpHistoryToolCall = {
	id: string;
	title: string;
	kind: string;
	status: string;
	input?: unknown;
	output?: unknown;
};

export type AcpHistoryPart =
	| { type: "reasoning"; text: string }
	| { type: "text"; text: string }
	| { type: "tool"; tool: AcpHistoryToolCall }
	| { type: "plan"; entries: AgentPlanEntry[] };

export type AcpHistoryLine = {
	id: string;
	kind: "user" | "agent";
	text: string;
	reasoning?: string | null;
	/** Ordered parts for agent lines (reasoning/text/tool/plan). */
	parts?: AcpHistoryPart[];
	sources?: string[];
	/** Visual PDF annotations attached to a user turn. */
	visualAnnotations?: {
		id: string;
		/** 1-based PDF page number. */
		page: number;
		comment: string;
		image: PromptImage;
		/** Vault-relative paper path when known. */
		paperPath?: string;
	}[];
	/** Multimodal images attached to a user turn. */
	images?: PromptImage[];
};

export type AcpLoadSessionResult = {
	sessionId: string;
	title?: string | null;
	lines: AcpHistoryLine[];
};

export type RunOnceAccepted = {
	sessionId: string;
	messageId: string;
	agentId: string;
};

export type AgentSkill = {
	id: string;
	name: string;
	description: string;
};

export type AgentResultPayload = {
	sessionId: string;
	messageId: string;
	content: string;
	/** ACP agent thought / reasoning text, if the agent emitted thought chunks. */
	reasoning?: string | null;
	sources: string[];
	stopReason?: string | null;
	writtenPaths?: string[];
	/** Durable ACP provider session id for the next `session/resume`. */
	providerSessionId?: string | null;
};

export type CitationTarget = {
	paperPath: string;
	path: string;
	fragment: string;
	pageIndex: number;
	bbox: { x: number; y: number; w: number; h: number };
	title?: string | null;
	regionId: string;
};

export type AgentStreamKind = "message" | "thought";

export type AgentStreamEvent = {
	sessionId: string;
	chunk: string;
	/** Defaults to message when older backends omit the field. */
	kind?: AgentStreamKind;
};

export type AgentToolEvent = {
	sessionId: string;
	toolCallId: string;
	title?: string | null;
	kind?: string | null;
	/** pending | in_progress | completed | failed */
	status?: string | null;
	input?: unknown;
	output?: unknown;
	full?: boolean;
};

export type AgentPlanEntry = {
	content: string;
	status: string;
	priority: string;
};

export type AgentPlanEvent = {
	sessionId: string;
	entries: AgentPlanEntry[];
};

export type AgentUsageEvent = {
	sessionId: string;
	used: number;
	size: number;
};

export type AgentSessionInfoEvent = {
	sessionId: string;
	agentId: string;
	providerSessionId?: string | null;
	title?: string | null;
	updatedAt?: string | null;
};

export type AgentCommand = {
	name: string;
	description: string;
	input?: { hint: string } | null;
};

export type AgentCommandsEvent = {
	sessionId: string;
	agentId: string;
	commands: AgentCommand[];
};

export type AgentModelChoice = {
	id: string;
	name: string;
	group?: string | null;
};

export type AgentModelsEvent = {
	sessionId: string;
	agentId: string;
	configId: string;
	currentId: string;
	models: AgentModelChoice[];
};

export type AgentEffortChoice = {
	id: string;
	name: string;
	description?: string | null;
};

export type AgentEffortEvent = {
	sessionId: string;
	agentId: string;
	configId: string;
	currentId: string;
	efforts: AgentEffortChoice[];
};

export type AgentFastModeEvent = {
	sessionId: string;
	agentId: string;
	configId: string;
	enabled: boolean;
};

export type AgentModeChoice = {
	id: string;
	name: string;
	description?: string | null;
};

/** Codex collaboration mode (Default / Plan) via config id collaboration_mode. */
export type AgentCollaborationEvent = {
	sessionId: string;
	agentId: string;
	configId: string;
	currentId: string;
	modes: AgentModeChoice[];
};

export type AgentFailedEvent = {
	sessionId: string;
	error: string;
};

/** Loading phase of a turn: before spawn, waiting for first model output, or upstream reconnect. */
export type AgentTurnPhase = "starting" | "waiting-model" | "reconnecting";

export type AgentStatusEvent = {
	sessionId: string;
	phase: AgentTurnPhase;
	/** e.g. "2/5" attempt counter for reconnecting. */
	detail?: string | null;
};

/** Runtime-tracked phase state for a session's current turn. */
export type AgentPhaseState = {
	phase: AgentTurnPhase;
	detail?: string;
};

export type PermissionOption = {
	optionId: string;
	name: string;
	/** allow_once | allow_always | reject_once | reject_always | other */
	kind: string;
};

/** One option for a form elicitation select field. */
export type ElicitationOption = {
	value: string;
	title: string;
	description?: string | null;
};

/** One field from ACP form elicitation (`elicitation/create`). */
export type ElicitationField = {
	id: string;
	title: string;
	description?: string | null;
	required: boolean;
	/** select | text | boolean | number | other */
	kind: string;
	options: ElicitationOption[];
	/** Codex free-text companion for the same logical question ("Other"). */
	isOtherAnswer?: boolean;
	/** Parent select field id when isOtherAnswer. */
	parentFieldId?: string | null;
};

/** ACP form elicitation request (Codex request_user_input). */
export type ElicitationRequest = {
	requestId: string;
	sessionId: string;
	message: string;
	toolCallId?: string | null;
	fields: ElicitationField[];
};

/** One option in a Grok `_x.ai/ask_user_question` (or similar) request. */
export type AskUserOptionDto = {
	label: string;
	description?: string | null;
};

/** One question in a Grok ask-user extension request. */
export type AskUserQuestionDto = {
	question: string;
	options: AskUserOptionDto[];
	multiSelect: boolean;
	allowOther: boolean;
};

/**
 * Grok Build ACP extension `_x.ai/ask_user_question` (Host → UI).
 * Not form elicitation; answers go back via `agent_respond_ask_user`.
 */
export type AskUserRequest = {
	requestId: string;
	sessionId: string;
	toolCallId?: string | null;
	/** default | plan */
	mode: string;
	questions: AskUserQuestionDto[];
};

/** ACP permission request forwarded to the user in "ask" mode. */
export type PermissionRequest = {
	requestId: string;
	sessionId: string;
	title: string;
	kind?: string | null;
	paths: string[];
	preview?: { before: string; after: string };
	options: PermissionOption[];
};

/** The browser product has one agent; no executable registry or CLI discovery. */
export async function listAgents(): Promise<AgentListResponse> {
	return {
		enabled: true,
		defaultId: "cloud",
		agents: [
			{
				id: "cloud",
				name: "Lattiora",
				template: "custom",
				command: "",
				args: [],
				env: {},
				available: true,
				lastProbeOk: null,
			},
		],
	};
}
export async function listAgentSkills(
	_vaultPath?: string,
): Promise<AgentSkill[]> {
	const { listSkills } = await import("@/lib/cloud/skills");
	return listSkills();
}
export async function scanCatalog(): Promise<CatalogScanResponse> {
	const registry = await listAgents();
	return {
		entries: [],
		customAgents: registry.agents,
		defaultId: "cloud",
		enabled: true,
		proxyEnabled: false,
		proxyUrl: "",
	};
}
export async function ensureCatalogAgent(
	id: string,
	_setDefault = false,
): Promise<AgentDescriptor> {
	if (id !== "cloud" && id !== "custom")
		throw new Error(i18n.t("agent:web.singleAgent"));
	return (await listAgents()).agents[0];
}
export async function setDefaultAgent(
	id: string | null,
): Promise<AgentListResponse> {
	if (id && id !== "cloud") throw new Error(i18n.t("agent:web.singleAgent"));
	return listAgents();
}

export async function runOnce(request: {
	agentId?: string;
	/** Durable provider conversation id; Codex uses its native thread id. */
	sessionId?: string;
	prompt: string;
	contextPaths?: string[];
	historyLines?: import("./chat-state").ChatLine[];
	isAcpCommand?: boolean;
	/** Multimodal crops for ACP Image content blocks */
	images?: PromptImage[];
	vaultPath?: string;
	workflow?: string;
	target?: string;
	/** ACP model config value id (from agent:models). */
	modelId?: string;
	/** Collaboration mode id (from agent:collaboration), e.g. default / plan. */
	collaborationModeId?: string;
	/** ACP reasoning-effort value id (from agent:effort). */
	reasoningEffort?: string;
	/** Resolve the highest supported effort after session setup, unless explicitly chosen. */
	preferHighestReasoningEffort?: boolean;
	/** ACP fast-mode preference (from agent:fast-mode). */
	fastMode?: boolean;
	/** Local SKILL.md identifiers selected through the composer. */
	skillIds?: string[];
	/** ACP permission handling: "restricted" | "ask" | "auto" (from settings). */
	permissionMode?: string;
	/**
	 * Force the language of the agent response and any generated notes.
	 * When omitted, runOnce falls back to the global `aiResponseLanguage`
	 * setting; `"auto"` (or omitting) sends no directive.
	 */
	responseLanguage?: string;
	/**
	 * User preference instructions injected into the prompt envelope.
	 * When omitted, runOnce falls back to `agentPersonalPrompt` settings;
	 * empty / whitespace-only is not sent.
	 */
	personalPrompt?: string;
	/**
	 * When true, Codex thread is not indexed into Agent chat history
	 * (paper-reader and other non-composer workflows).
	 */
	hideFromChatHistory?: boolean;
}): Promise<RunOnceAccepted> {
	const settings = loadSettings();
	const language = request.responseLanguage ?? settings.aiResponseLanguage;
	const responseLanguage =
		language && language !== "auto" ? language : undefined;
	const personalRaw = request.personalPrompt ?? settings.agentPersonalPrompt;
	const personalPrompt = personalRaw?.trim() ? personalRaw.trim() : undefined;
	void import("@/lib/activity").then(({ track }) => {
		track("agent.run", {
			path: request.target,
			extra: {
				workflow: request.workflow ?? "free",
				skillCount: request.skillIds?.length ?? 0,
			},
		});
	});
	const { runBrowserAgent } = await import("@/lib/cloud/agent-runtime");
	return runBrowserAgent({ ...request, responseLanguage, personalPrompt });
}

/** List ACP sessions for an agent via `session/list`. */
export async function listSessions(_request: {
	agentId?: string;
	vaultPath?: string;
	cursor?: string;
}): Promise<AcpListSessionsResult> {
	const { browserSessionList } = await import("@/lib/cloud/agent-sessions");
	return browserSessionList();
}

/** Load an ACP session's history via `session/load`. */
export async function loadSession(request: {
	agentId?: string;
	sessionId: string;
	vaultPath?: string;
}): Promise<AcpLoadSessionResult> {
	const { browserSessionLoad } = await import("@/lib/cloud/agent-sessions");
	return browserSessionLoad(request.sessionId);
}
export async function cancelAgentRun(sessionId: string): Promise<void> {
	const { cancelBrowserRun } = await import("@/lib/cloud/agent-runtime");
	await cancelBrowserRun(sessionId);
}
export async function respondPermission(
	requestId: string,
	optionId: string | null,
): Promise<void> {
	const { answerAgentRequest } = await import("@/lib/cloud/agent-runtime");
	await answerAgentRequest(requestId, "permission", optionId);
}
export async function respondElicitation(_request: {
	requestId: string;
	action: "accept" | "decline" | "cancel";
	content?: Record<string, string>;
}): Promise<void> {
	throw new Error(i18n.t("cloud:errors.requestExpired"));
}
export async function respondAskUser(request: {
	requestId: string;
	action: "accept" | "cancel";
	answers?: string[];
}): Promise<void> {
	const { answerAgentRequest } = await import("@/lib/cloud/agent-runtime");
	await answerAgentRequest(
		request.requestId,
		"ask",
		request.action === "accept"
			? { answers: request.answers ?? [] }
			: { cancelled: true },
	);
}

export type WarmResult = {
	agentId: string;
	ok: boolean;
	models?: AgentModelsEvent | null;
	usageUsed?: number | null;
	usageSize?: number | null;
	error?: string | null;
};

/** Read configured model metadata without a paid model request. */
export async function warmAgent(_request: {
	agentId?: string;
	vaultPath?: string;
	modelId?: string;
	collaborationModeId?: string;
}): Promise<WarmResult> {
	const { getAiConfig } = await import("@/lib/cloud/ai");
	const config = await getAiConfig();
	return {
		agentId: "cloud",
		ok: Boolean(config),
		error: config ? null : "aiNotConfigured",
		models: config
			? {
					sessionId: "",
					agentId: "cloud",
					configId: "model",
					currentId: config.model,
					models: [{ id: config.model, name: config.model }],
				}
			: null,
	};
}

/** Resolve an inline citation link to PDF page/bbox coordinates. */
export async function resolvePdfCitation(
	_vaultPath: string,
	source: string,
): Promise<CitationTarget> {
	const { resolveBrowserCitation } = await import(
		"@/lib/cloud/agent-citations"
	);
	return resolveBrowserCitation(source);
}

export function listenAgentStream(
	handler: (e: AgentStreamEvent) => void,
): Promise<UnlistenFn> {
	return events.agentStream.listen((message) => handler(message.payload));
}

export function listenAgentCompleted(
	handler: (e: AgentResultPayload) => void,
): Promise<UnlistenFn> {
	return events.agentCompleted.listen((message) => handler(message.payload));
}

export function listenAgentFailed(
	handler: (e: AgentFailedEvent) => void,
): Promise<UnlistenFn> {
	return events.agentFailed.listen((message) => handler(message.payload));
}

export function listenAgentStatus(
	handler: (e: AgentStatusEvent) => void,
): Promise<UnlistenFn> {
	return events.agentStatus.listen((message) =>
		handler(message.payload as AgentStatusEvent),
	);
}

export function listenAgentTool(
	handler: (e: AgentToolEvent) => void,
): Promise<UnlistenFn> {
	return events.agentTool.listen((message) => handler(message.payload));
}

export function listenAgentPlan(
	handler: (e: AgentPlanEvent) => void,
): Promise<UnlistenFn> {
	return events.agentPlan.listen((message) => handler(message.payload));
}

export function listenAgentUsage(
	handler: (e: AgentUsageEvent) => void,
): Promise<UnlistenFn> {
	return events.agentUsage.listen((message) => handler(message.payload));
}

export function listenAgentSessionInfo(
	handler: (e: AgentSessionInfoEvent) => void,
): Promise<UnlistenFn> {
	return events.agentSessionInfo.listen((message) => handler(message.payload));
}

export function listenAgentCommands(
	handler: (e: AgentCommandsEvent) => void,
): Promise<UnlistenFn> {
	return events.agentCommands.listen((message) => handler(message.payload));
}

export function listenAgentModels(
	handler: (e: AgentModelsEvent) => void,
): Promise<UnlistenFn> {
	return events.agentModels.listen((message) => handler(message.payload));
}

export function listenAgentEffort(
	handler: (e: AgentEffortEvent) => void,
): Promise<UnlistenFn> {
	return events.agentEffort.listen((message) => handler(message.payload));
}

export function listenAgentFastMode(
	handler: (e: AgentFastModeEvent) => void,
): Promise<UnlistenFn> {
	return events.agentFastMode.listen((message) => handler(message.payload));
}

export function listenAgentCollaboration(
	handler: (e: AgentCollaborationEvent) => void,
): Promise<UnlistenFn> {
	return events.agentCollaboration.listen((message) =>
		handler(message.payload),
	);
}

const MODEL_PREF_KEY = "agentero-agent-model-pref";

/** Persist last chosen model id per agent. */
export function loadModelPref(agentId: string | null): string | null {
	if (!agentId) return null;
	const map = readJsonStorage<Record<string, string>>(MODEL_PREF_KEY, {});
	return typeof map[agentId] === "string" ? map[agentId] : null;
}

export function saveModelPref(agentId: string, modelId: string): void {
	const map = readJsonStorage<Record<string, string>>(MODEL_PREF_KEY, {});
	map[agentId] = modelId;
	writeJsonStorage(MODEL_PREF_KEY, map);
}

const COLLABORATION_PREF_KEY = "agentero-agent-collaboration-pref";

/** Persist last chosen collaboration mode (default / plan) per agent. */
export function loadCollaborationPref(agentId: string | null): string | null {
	if (!agentId) return null;
	const map = readJsonStorage<Record<string, string>>(
		COLLABORATION_PREF_KEY,
		{},
	);
	return typeof map[agentId] === "string" ? map[agentId] : null;
}

export function saveCollaborationPref(
	agentId: string,
	collaborationModeId: string,
): void {
	const map = readJsonStorage<Record<string, string>>(
		COLLABORATION_PREF_KEY,
		{},
	);
	map[agentId] = collaborationModeId;
	writeJsonStorage(COLLABORATION_PREF_KEY, map);
}

const MODEL_FAVORITES_KEY = "agentero-agent-model-favorites";

/** Per-agent ordered list of favorited model ids. */
export function loadModelFavorites(agentId: string | null): string[] {
	if (!agentId) return [];
	const map = readJsonStorage<Record<string, string[]>>(
		MODEL_FAVORITES_KEY,
		{},
	);
	const list = map[agentId];
	return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
}

export function saveModelFavorites(agentId: string, ids: string[]): void {
	const map = readJsonStorage<Record<string, string[]>>(
		MODEL_FAVORITES_KEY,
		{},
	);
	map[agentId] = ids;
	writeJsonStorage(MODEL_FAVORITES_KEY, map);
}

const MODEL_CATALOG_KEY = "agentero-agent-model-catalog";

export type CachedModelCatalog = {
	configId: string;
	currentId: string;
	models: AgentModelChoice[];
};

export function loadModelCatalog(
	agentId: string | null,
): CachedModelCatalog | null {
	if (!agentId) return null;
	const map = readJsonStorage<Record<string, CachedModelCatalog>>(
		MODEL_CATALOG_KEY,
		{},
	);
	return map[agentId] ?? null;
}

export function saveModelCatalog(
	agentId: string,
	catalog: CachedModelCatalog,
): void {
	const map = readJsonStorage<Record<string, CachedModelCatalog>>(
		MODEL_CATALOG_KEY,
		{},
	);
	map[agentId] = catalog;
	writeJsonStorage(MODEL_CATALOG_KEY, map);
}

export function isAgentAuthFailure(error?: string | null): boolean {
	if (!error) return false;
	return /invalid_grant|failed to authenticate|authentication failed|not authenticated|login required|unauthenticated|authentication required|authrequired|not logged in/i.test(
		error,
	);
}

export function acpStatusLabel(
	status: CatalogAcpStatus,
	error?: string | null,
): string {
	switch (status) {
		case "ready":
			return i18n.t("agent:acpStatus.ready");
		case "failed":
			if (isAgentAuthFailure(error)) {
				return i18n.t("agent:acpStatus.notLoggedIn");
			}
			return i18n.t("agent:acpStatus.failed");
		case "not-probed":
			return i18n.t("agent:acpStatus.notProbed");
		case "missing":
			return i18n.t("agent:acpStatus.notInstalled");
	}
}
