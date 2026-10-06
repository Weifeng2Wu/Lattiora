/**
 * Shared, lightweight identity of the agent currently reflected in app chrome
 * (title-bar icon, mobile nav, …). The Agent panel writes the active selection;
 * the app shell seeds the registry default on boot so the chrome is correct
 * before the panel is ever opened.
 */

import { createStore, useStore } from "zustand";
import type { AgentTemplate } from "@/lib/agent/api";

type AgentChromeState = {
	agentId: string | null;
	name: string | null;
	template: AgentTemplate | null;
};

type AgentChromeStore = AgentChromeState & {
	setCurrentAgent: (agent: AgentChromeState) => void;
	clearCurrentAgent: () => void;
};

export const agentChromeStore = createStore<AgentChromeStore>((set) => ({
	agentId: null,
	name: null,
	template: null,
	setCurrentAgent: (agent) =>
		set((s) => {
			if (
				s.agentId === agent.agentId &&
				s.name === agent.name &&
				s.template === agent.template
			) {
				return s;
			}
			return agent;
		}),
	clearCurrentAgent: () =>
		set((s) =>
			s.agentId === null && s.name === null && s.template === null
				? s
				: { agentId: null, name: null, template: null },
		),
}));

export function useAgentChromeStore<T>(
	selector: (state: AgentChromeStore) => T,
): T {
	return useStore(agentChromeStore, selector);
}

export function getAgentChromeState(): AgentChromeState {
	return agentChromeStore.getState();
}
