import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type AgentComposerState,
	clearSubmittedComposerState,
	composerScopeKey,
	loadAgentComposerState,
	removeAgentComposerState,
	saveAgentComposerState,
} from "@/lib/agent/composer-state";

type SessionComposerStateOptions = {
	vaultPath: string | null;
	agentId: string | null;
	sessionId: string;
	defaultIncludeSelectedFile: boolean;
};

type ComposerIdentity = {
	scopeKey: string | null;
	sessionId: string;
};

function emptyComposerState(includeSelectedFile: boolean): AgentComposerState {
	return {
		text: "",
		mentionedPaths: [],
		selectedSkillIds: [],
		includeSelectedFile,
	};
}

function browserStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** Live composer state plus the session-scoped persistence API around it. */
export type SessionComposerStateApi = AgentComposerState & {
	activateSession: (sessionId: string) => void;
	completeSubmission: (
		sessionId: string,
		submitted: AgentComposerState,
	) => void;
	migrateSession: (sessionId: string) => void;
	resetSession: (sessionId: string) => void;
	setIncludeSelectedFile: Dispatch<SetStateAction<boolean>>;
	setMentionedPaths: Dispatch<SetStateAction<string[]>>;
	setSelectedSkillIds: Dispatch<SetStateAction<string[]>>;
	setText: Dispatch<SetStateAction<string>>;
	snapshot: () => AgentComposerState;
};

export function useSessionComposerState({
	vaultPath,
	agentId,
	sessionId,
	defaultIncludeSelectedFile,
}: SessionComposerStateOptions): SessionComposerStateApi {
	const scopeKey = composerScopeKey(vaultPath, agentId);
	const defaultIncludeSelectedFileRef = useRef(defaultIncludeSelectedFile);
	defaultIncludeSelectedFileRef.current = defaultIncludeSelectedFile;
	const identityRef = useRef<ComposerIdentity>({ scopeKey, sessionId });
	const [state, setState] = useState<AgentComposerState>(() =>
		emptyComposerState(defaultIncludeSelectedFile),
	);
	const stateRef = useRef(state);

	const readState = useCallback((identity: ComposerIdentity) => {
		const storage = browserStorage();
		if (!storage || !identity.scopeKey) {
			return emptyComposerState(defaultIncludeSelectedFileRef.current);
		}
		return (
			loadAgentComposerState(storage, identity.scopeKey, identity.sessionId) ??
			emptyComposerState(defaultIncludeSelectedFileRef.current)
		);
	}, []);

	const commitState = useCallback((next: AgentComposerState) => {
		stateRef.current = next;
		setState(next);
		const storage = browserStorage();
		const identity = identityRef.current;
		if (storage && identity.scopeKey) {
			saveAgentComposerState(
				storage,
				identity.scopeKey,
				identity.sessionId,
				next,
			);
		}
	}, []);

	const updateState = useCallback(
		(updater: SetStateAction<AgentComposerState>) => {
			const current = stateRef.current;
			const next = typeof updater === "function" ? updater(current) : updater;
			if (next === current) return;
			commitState(next);
		},
		[commitState],
	);

	const updateField = useCallback(
		<K extends keyof AgentComposerState>(
			key: K,
			value: SetStateAction<AgentComposerState[K]>,
		) => {
			updateState((current) => {
				const nextValue =
					typeof value === "function"
						? (
								value as (
									previous: AgentComposerState[K],
								) => AgentComposerState[K]
							)(current[key])
						: value;
				return Object.is(nextValue, current[key])
					? current
					: { ...current, [key]: nextValue };
			});
		},
		[updateState],
	);

	const setText: Dispatch<SetStateAction<string>> = useCallback(
		(value) => updateField("text", value),
		[updateField],
	);
	const setMentionedPaths: Dispatch<SetStateAction<string[]>> = useCallback(
		(value) => updateField("mentionedPaths", value),
		[updateField],
	);
	const setSelectedSkillIds: Dispatch<SetStateAction<string[]>> = useCallback(
		(value) => updateField("selectedSkillIds", value),
		[updateField],
	);
	const setIncludeSelectedFile: Dispatch<SetStateAction<boolean>> = useCallback(
		(value) => updateField("includeSelectedFile", value),
		[updateField],
	);

	const activateSession = useCallback(
		(nextSessionId: string) => {
			const nextIdentity = {
				scopeKey: identityRef.current.scopeKey,
				sessionId: nextSessionId,
			};
			identityRef.current = nextIdentity;
			const next = readState(nextIdentity);
			stateRef.current = next;
			setState(next);
		},
		[readState],
	);

	const resetSession = useCallback(
		(nextSessionId: string) => {
			identityRef.current = {
				scopeKey: identityRef.current.scopeKey,
				sessionId: nextSessionId,
			};
			commitState(emptyComposerState(defaultIncludeSelectedFileRef.current));
		},
		[commitState],
	);

	const rebindSession = useCallback(
		(nextSessionId: string, next: AgentComposerState) => {
			const previousIdentity = identityRef.current;
			const storage = browserStorage();
			if (
				storage &&
				previousIdentity.scopeKey &&
				previousIdentity.sessionId !== nextSessionId
			) {
				removeAgentComposerState(
					storage,
					previousIdentity.scopeKey,
					previousIdentity.sessionId,
				);
			}
			identityRef.current = {
				scopeKey: previousIdentity.scopeKey,
				sessionId: nextSessionId,
			};
			commitState(next);
		},
		[commitState],
	);

	const migrateSession = useCallback(
		(nextSessionId: string) => rebindSession(nextSessionId, stateRef.current),
		[rebindSession],
	);

	const completeSubmission = useCallback(
		(nextSessionId: string, submitted: AgentComposerState) => {
			const next = clearSubmittedComposerState(stateRef.current, submitted);
			rebindSession(nextSessionId, next);
		},
		[rebindSession],
	);

	useLayoutEffect(() => {
		const current = identityRef.current;
		if (current.scopeKey === scopeKey && current.sessionId === sessionId)
			return;
		const nextIdentity = { scopeKey, sessionId };
		identityRef.current = nextIdentity;
		if (
			!current.scopeKey &&
			scopeKey &&
			current.sessionId === sessionId &&
			(stateRef.current.text.length > 0 ||
				stateRef.current.mentionedPaths.length > 0 ||
				stateRef.current.selectedSkillIds.length > 0)
		) {
			commitState(stateRef.current);
			return;
		}
		const next = readState(nextIdentity);
		stateRef.current = next;
		setState(next);
	}, [commitState, readState, scopeKey, sessionId]);

	return {
		...state,
		activateSession,
		completeSubmission,
		migrateSession,
		resetSession,
		setIncludeSelectedFile,
		setMentionedPaths,
		setSelectedSkillIds,
		setText,
		snapshot: () => stateRef.current,
	};
}
