/**
 * Agent panel session/runtime orchestrator: composes the focused sub-hooks
 * (context, config, session runtime, permission surfaces, send, message edit,
 * composer, history) and owns cross-cutting lifecycle — vault switch reset,
 * cross-window session handoff, agent switch, and new conversation.
 * UI lives in sibling components under `src/components/agent/`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentComposer } from "@/components/agent/hooks/use-agent-composer";
import { useAgentConfig } from "@/components/agent/hooks/use-agent-config";
import { useAgentHistory } from "@/components/agent/hooks/use-agent-history";
import { useAgentMessageEdit } from "@/components/agent/hooks/use-agent-message-edit";
import { useAgentPanelContext } from "@/components/agent/hooks/use-agent-panel-context";
import { useAgentPermissionSurfaces } from "@/components/agent/hooks/use-agent-permission-surfaces";
import { useAgentSend } from "@/components/agent/hooks/use-agent-send";
import { useAgentSessionRuntime } from "@/components/agent/hooks/use-agent-session-runtime";
import type { AgentPanelProps } from "@/components/agent/types";
import { useSessionComposerState } from "@/hooks/use-session-composer-state";
import {
	cancelAgentRun,
	ensureCatalogAgent,
	setDefaultAgent,
} from "@/lib/agent";
import { agentChromeStore } from "@/lib/agent/agent-chrome-store";
import {
	applyAgentSessionHandoffOnce,
	isActiveTabRunning,
	useActiveChatLines,
	useAgentSessionStore,
} from "@/lib/agent/agent-session-store";
import {
	type AgentOption,
	buildOptions,
	errorChatLine,
	errorText,
	resolveSelected,
} from "@/lib/agent/chat-state";
import { removeVisualDraft } from "@/lib/agent/visual-context-store";
import { isCloud } from "@/lib/core/tauri";
import { listenAgentSessionHandoff } from "@/lib/shell/workspace-broadcast";

export type UseAgentPanelArgs = Pick<
	AgentPanelProps,
	| "vaultPath"
	| "selectedPath"
	| "selectedPaperTitle"
	| "vaultMarkdownPaths"
	| "vaultDirectoryPaths"
	| "vaultPaperPaths"
	| "paperMetaByRelPath"
	| "paperTreeLabelMode"
>;

export function useAgentPanel({
	vaultPath,
	selectedPath = null,
	selectedPaperTitle = null,
	vaultMarkdownPaths = [],
	vaultDirectoryPaths = [],
	vaultPaperPaths = [],
	paperMetaByRelPath = null,
	paperTreeLabelMode = "title-author",
}: UseAgentPanelArgs) {
	const { t, i18n } = useTranslation("agent");

	const {
		selectedVaultPath,
		directoryPathSet,
		paperPathSet,
		labelForPath,
		mentionLabelsByPath,
		refs,
		resetSessionContext,
	} = useAgentPanelContext({
		vaultPath,
		selectedPath,
		selectedPaperTitle,
		vaultMarkdownPaths,
		vaultDirectoryPaths,
		vaultPaperPaths,
		paperMetaByRelPath,
		paperTreeLabelMode,
	});
	const {
		activeConversationRef,
		activeTabRef,
		selectedAgentIdRef,
		switchingRef,
		submittingRef,
		submissionGenRef,
		historyHydrationGenRef,
		knownSessionIdsRef,
		sessionHistoryRef,
		vaultPathRef,
	} = refs;

	// Shared store selectors (single source of truth for the transcript).
	const lines = useActiveChatLines();
	const setLines = useAgentSessionStore((s) => s.setLines);
	const sessionHistory = useAgentSessionStore((s) => s.sessions);
	const setSessionHistory = useAgentSessionStore((s) => s.setSessions);
	const activeTabId = useAgentSessionStore((s) => s.activeTabId);
	const hydratingSessionId = useAgentSessionStore((s) => s.hydratingSessionId);
	const setActiveTabId = useAgentSessionStore((s) => s.setActiveTabId);
	const startDraft = useAgentSessionStore((s) => s.startDraft);
	const setHydratingSessionId = useAgentSessionStore(
		(s) => s.setHydratingSessionId,
	);
	const hydrateAndActivateSession = useAgentSessionStore(
		(s) => s.hydrateAndActivateSession,
	);

	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [switching, setSwitching] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);

	/**
	 * Sole writer for the submitting flag: mirrors it into submittingRef for
	 * synchronous guards in event callbacks while updating render state.
	 * Never write the ref or the state directly.
	 */
	const setSubmittingFlag = useCallback(
		(value: boolean) => {
			submittingRef.current = value;
			setSubmitting(value);
		},
		[submittingRef],
	);

	const composerState = useSessionComposerState({
		vaultPath,
		agentId: selectedAgentId,
		sessionId: activeTabId,
		// Current paper/file is always in context by default (no click-to-add).
		defaultIncludeSelectedFile: true,
	});
	const {
		text: composerText,
		mentionedPaths,
		includeSelectedFile,
		activateSession: activateComposerSession,
		resetSession: resetComposerSession,
		setText: setComposerText,
		setSelectedSkillIds,
	} = composerState;

	const contextPaths = useMemo(() => {
		const paths = [
			...(includeSelectedFile && selectedVaultPath ? [selectedVaultPath] : []),
			...mentionedPaths,
		];
		return [...new Set(paths)];
	}, [includeSelectedFile, mentionedPaths, selectedVaultPath]);

	/** Current paper/file path when included (always-on chip; no dashed + toggle). */
	const currentFilePath =
		includeSelectedFile && selectedVaultPath ? selectedVaultPath : null;

	useEffect(() => {
		sessionHistoryRef.current = sessionHistory;
	}, [sessionHistory, sessionHistoryRef]);

	/** Last-seen vault path; drives the vault-switch reset effect below. */
	const previousVaultPathRef = useRef(vaultPath);

	useEffect(() => {
		vaultPathRef.current = vaultPath;
	}, [vaultPath, vaultPathRef]);

	const {
		registry,
		catalog,
		skills,
		models,
		modelId,
		favoriteIds,
		modelSelectorOpen,
		setModelSelectorOpen,
		warming,
		setAgentListenersReady,
		usage,
		setUsage,
		usageBySession,
		setUsageBySession,
		acpCommandsByAgent,
		setAcpCommandsByAgent,
		collaborationOptions,
		collaborationModeId,
		effortOptions,
		reasoningEffort,
		pickReasoningEffort,
		fastAvailable,
		fastEnabled,
		setFastEnabled,
		applyModelsEvent,
		applyCollaborationEvent,
		applyEffortEvent,
		applyFastModeEvent,
		refresh,
		selectedModelName,
		groupedModels,
		selectedCollaborationName,
		pickCollaborationMode,
		pickModel,
		toggleFavorite,
	} = useAgentConfig({
		vaultPath,
		selectedAgentId,
		setSelectedAgentId,
		refs,
		t,
		setLines,
	});

	const options = buildOptions(registry, catalog);
	const selected = resolveSelected(options, selectedAgentId, registry);

	// Keep app chrome (title bar, mobile nav, …) in sync with the active agent.
	useEffect(() => {
		if (!selected) return;
		agentChromeStore.setState({
			agentId: selected.id,
			name: selected.name,
			template: selected.template ?? null,
		});
	}, [selected]);

	const activeTabIsRunning = useAgentSessionStore(isActiveTabRunning);
	const activeUsage = usageBySession[activeTabId] ?? usage;
	const hasRunningSessions = sessionHistory.some(
		(session) => session.status === "running",
	);

	const runtime = useAgentSessionRuntime({
		refs,
		t,
		setSessionHistory,
		applyModelsEvent,
		applyCollaborationEvent,
		applyEffortEvent,
		applyFastModeEvent,
		setUsage,
		setUsageBySession,
		setAcpCommandsByAgent,
		setAgentListenersReady,
	});
	const { toolAskUserRequest, setToolAskUserRequest, phaseBySession } = runtime;

	const {
		permissionRequest,
		setPermissionRequest,
		elicitationRequest,
		setElicitationRequest,
		askUserRequest,
		setAskUserRequest,
	} = useAgentPermissionSurfaces({
		toolAskUserRequest,
		setToolAskUserRequest,
	});

	/** Request-shaping context for the send pipeline (agent/model selection). */
	const turnConfig = {
		selected,
		registry,
		refresh,
		modelId,
		collaborationModeId,
		collaborationOptions,
		reasoningEffort,
		fastAvailable,
		fastEnabled,
		acpCommandsByAgent,
	};

	const {
		send,
		submitComposer,
		messageQueue,
		removeQueuedMessage,
		clearMessageQueue,
		cancelCurrentRun,
		answerToolAskUser,
	} = useAgentSend({
		refs,
		t,
		i18nLanguage: i18n.language,
		vaultPath,
		lines,
		submitting,
		switching,
		setSubmittingFlag,
		setHistoryOpen,
		setSelectedAgentId,
		selectedVaultPath,
		contextPaths,
		composer: composerState,
		turnConfig,
		runtime,
	});

	const {
		editingLineId,
		editingText,
		setEditingText,
		editTextareaRef,
		editCompositionProps,
		isEditBlockedByIme,
		startEditingMessage,
		cancelEditingMessage,
		resendEditedMessage,
	} = useAgentMessageEdit({
		refs,
		activeTabId,
		activeTabIsRunning,
		lines,
		send,
	});

	const {
		setComposerMenuDismissed,
		setMentionActiveIndex,
		setSkillActiveIndex,
		setSlashActiveIndex,
		currentFileLabel,
		mentionChipPaths,
		selectionChips,
		visualDrafts,
		removeContextPath,
		selectedSkills,
		showMentionMenu,
		mentionBrowseRoot,
		mentionOptions,
		mentionActiveIndex,
		mentionCandidates,
		leaveMentionFolder,
		enterMentionFolder,
		attachMention,
		showSkillMenu,
		skillOptions,
		skillActiveIndex,
		attachSkill,
		removeSkill,
		showSlashMenu,
		slashOptions,
		slashActiveIndex,
		attachSlashCommand,
		handleComposerMenuKeyDown,
		handleComposerDragOver,
		handleComposerDrop,
		onComposerTextChangeFromUser,
		composerInputRef,
	} = useAgentComposer({
		refs,
		composer: composerState,
		vaultPath,
		vaultMarkdownPaths,
		vaultDirectoryPaths,
		vaultPaperPaths,
		selectedPaperTitle,
		selectedVaultPath,
		paperPathSet,
		labelForPath,
		mentionLabelsByPath,
		contextPaths,
		currentFilePath,
		skills,
		acpCommandsByAgent,
		selectedAgentId,
		lines,
		activeTabIsRunning,
		cancelCurrentRun,
	});

	// Vault switch: cancel running sessions and reset the whole panel context.
	useEffect(() => {
		if (previousVaultPathRef.current === vaultPath) return;
		previousVaultPathRef.current = vaultPath;
		for (const session of sessionHistoryRef.current) {
			if (session.status === "running") {
				void cancelAgentRun(session.id).catch(() => undefined);
			}
		}
		resetSessionContext();
		submissionGenRef.current += 1;
		setSubmittingFlag(false);
		setLines([]);
		setSessionHistory([]);
		setUsage(null);
		setUsageBySession({});
		setHistoryOpen(false);
		setComposerMenuDismissed(false);
		setMentionActiveIndex(0);
		setSkillActiveIndex(0);
		setActiveTabId("draft");
		setHydratingSessionId(null);
		activeTabRef.current = "draft";
		activeConversationRef.current = null;
		clearMessageQueue();
	}, [
		vaultPath,
		clearMessageQueue,
		setLines,
		setSessionHistory,
		setActiveTabId,
		setHydratingSessionId,
		resetSessionContext,
		setUsage,
		setUsageBySession,
		setComposerMenuDismissed,
		setMentionActiveIndex,
		setSkillActiveIndex,
		activeTabRef,
		setSubmittingFlag,
		activeConversationRef,
		submissionGenRef,
		sessionHistoryRef.current,
	]);

	// Cross-window handoff: first snapshot only (retries may arrive later).
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		void listenAgentSessionHandoff((payload) => {
			const applied = applyAgentSessionHandoffOnce({
				sessions: payload.sessions,
				activeTabId: payload.activeTabId,
				draftLines: payload.draftLines,
			});
			if (!applied) return;
			const agentId =
				payload.selectedAgentId ??
				payload.sessions.find((s) => s.id === payload.activeTabId)?.agentId ??
				payload.sessions[0]?.agentId ??
				null;
			if (agentId) {
				setSelectedAgentId(agentId);
				selectedAgentIdRef.current = agentId;
			}
			const tabId = payload.activeTabId || "draft";
			activeTabRef.current = tabId;
			activeConversationRef.current = tabId === "draft" ? null : tabId;
			knownSessionIdsRef.current = new Set(
				(payload.sessions ?? []).map((s) => s.id),
			);
			// Composer scope follows session id; force activate after handoff.
			activateComposerSession(tabId);
		}).then((u) => {
			unlisten = u;
		});
		return () => {
			unlisten?.();
		};
	}, [
		activateComposerSession,
		selectedAgentIdRef,
		knownSessionIdsRef,
		activeTabRef,
		activeConversationRef,
	]);

	const selectAgent = async (opt: AgentOption) => {
		if (
			!isCloud() ||
			switchingRef.current ||
			hasRunningSessions ||
			submittingRef.current
		)
			return;
		if (opt.id && opt.id === selectedAgentId) return;

		switchingRef.current = true;
		setSwitching(true);
		try {
			let agentId = opt.id;
			if (!agentId && opt.templateId) {
				const agent = await ensureCatalogAgent(opt.templateId, true);
				agentId = agent.id;
			} else if (agentId) {
				await setDefaultAgent(agentId);
			} else {
				return;
			}
			resetSessionContext();
			selectedAgentIdRef.current = agentId;
			activeConversationRef.current = null;
			activateComposerSession("draft");
			activeTabRef.current = "draft";
			setActiveTabId("draft");
			setHydratingSessionId(null);
			setLines([]);
			setSessionHistory([]);
			clearMessageQueue();
			setSelectedAgentId(agentId);
			await refresh();
		} catch (e) {
			setLines((p) => [...p, errorChatLine(errorText(e))]);
		} finally {
			switchingRef.current = false;
			setSwitching(false);
		}
	};

	const newConversation = () => {
		if (submittingRef.current) return;
		historyHydrationGenRef.current += 1;
		startDraft();
		resetComposerSession("draft");
		activeTabRef.current = "draft";
		activeConversationRef.current = null;
		clearMessageQueue();
	};

	const { openHistorySession } = useAgentHistory({
		refs,
		t,
		i18nLanguage: i18n.language,
		vaultPath,
		selectedAgentId,
		setSelectedAgentId,
		selected,
		setSessionHistory,
		setLines,
		hydrateAndActivateSession,
		setHydratingSessionId,
		activateComposerSession,
		setHistoryOpen,
		historyOpen,
		clearMessageQueue,
	});

	return {
		t,
		// Transcript
		lines,
		activeTabId,
		hydratingSessionId,
		selected,
		activeTabIsRunning,
		/** Loading phase of the active tab's in-flight turn (starting / waiting / reconnecting). */
		activePhase: phaseBySession[activeTabId] ?? null,
		submitting,
		switching,
		editingLineId,
		editingText,
		editTextareaRef,
		editCompositionProps,
		isEditBlockedByIme,
		setEditingText,
		cancelEditingMessage,
		resendEditedMessage,
		startEditingMessage,
		send,
		submitComposer,
		messageQueue,
		removeQueuedMessage,
		// History
		sessionHistory,
		historyOpen,
		setHistoryOpen,
		newConversation,
		openHistorySession,
		// Agent switcher
		options,
		selectedAgentId,
		hasRunningSessions,
		selectAgent,
		// Composer
		composerText,
		setComposerText,
		onComposerTextChangeFromUser,
		composerInputRef,
		setComposerMenuDismissed,
		setMentionActiveIndex,
		setSkillActiveIndex,
		setSlashActiveIndex,
		handleComposerMenuKeyDown,
		handleComposerDragOver,
		handleComposerDrop,
		currentFilePath,
		currentFileLabel,
		mentionChipPaths,
		selectionChips,
		visualDrafts,
		removeVisualDraft,
		directoryPathSet,
		paperPathSet,
		labelForPath,
		removeContextPath,
		selectedSkills,
		setSelectedSkillIds,
		showMentionMenu,
		mentionBrowseRoot,
		mentionOptions,
		mentionActiveIndex,
		mentionCandidates,
		leaveMentionFolder,
		enterMentionFolder,
		attachMention,
		showSkillMenu,
		skillOptions,
		skillActiveIndex,
		attachSkill,
		removeSkill,
		showSlashMenu,
		slashOptions,
		slashActiveIndex,
		attachSlashCommand,
		modelSelectorOpen,
		setModelSelectorOpen,
		models,
		groupedModels,
		modelId,
		selectedModelName,
		favoriteIds,
		warming,
		pickModel,
		toggleFavorite,
		collaborationOptions,
		collaborationModeId,
		selectedCollaborationName,
		pickCollaborationMode,
		effortOptions,
		reasoningEffort,
		pickReasoningEffort,
		activeUsage,
		fastAvailable,
		fastEnabled,
		setFastEnabled,
		cancelCurrentRun,
		// Permission
		permissionRequest,
		setPermissionRequest,
		// Form elicitation (request_user_input)
		elicitationRequest,
		setElicitationRequest,
		// Grok ask-user extension
		askUserRequest,
		setAskUserRequest,
		// Tool-shaped ask promoted to composer
		toolAskUserRequest,
		setToolAskUserRequest,
		answerToolAskUser,
		// Refs used by composer submit race guards
		switchingRef,
		submittingRef,
	};
}
