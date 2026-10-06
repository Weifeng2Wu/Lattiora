"use client";

import { useTranslation } from "react-i18next";
import { ThinkingOrb } from "thinking-orbs";
import type { AgentPhaseState } from "@/lib/agent/api";
import type { AgentPart } from "@/lib/agent/chat-state";

type AgentActivity = "thinking" | "working" | "solving";

type OrbConfig = {
	state:
		| "working"
		| "connecting"
		| "solving"
		| "shaping"
		| "breathing"
		| "searching";
};

/** Part-derived activity → orb state (tool work / thinking / planning). */
const activityToOrbState: Record<AgentActivity, OrbConfig> = {
	thinking: { state: "working" },
	working: { state: "connecting" },
	solving: { state: "solving" },
};

/**
 * Backend loading phase → dedicated orb state: starting forms the connection
 * (shaping), waiting-model idles on a live socket (breathing), reconnecting
 * hunts for the upstream (searching). Phase overrides part-derived activity.
 */
const phaseToOrbState: Record<AgentPhaseState["phase"], OrbConfig> = {
	starting: { state: "shaping" },
	"waiting-model": { state: "breathing" },
	reconnecting: { state: "searching" },
};

const phaseLabelKey: Record<
	AgentPhaseState["phase"],
	"streaming.starting" | "streaming.waitingModel" | "streaming.reconnecting"
> = {
	starting: "streaming.starting",
	"waiting-model": "streaming.waitingModel",
	reconnecting: "streaming.reconnecting",
};

function resolveActivity(parts: AgentPart[]): AgentActivity {
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index];
		if (part.type === "tool") {
			if (
				part.tool.status === "in_progress" ||
				part.tool.status === "pending"
			) {
				return "working";
			}
			continue;
		}
		if (part.type === "reasoning" && part.text.trim().length > 0) {
			return "thinking";
		}
		if (part.type === "plan") {
			const hasIncomplete = part.entries.some(
				(entry) => entry.status !== "completed",
			);
			if (hasIncomplete) return "solving";
			continue;
		}
		if (part.type === "text" && part.text.trim().length > 0) {
			return "thinking";
		}
	}
	return "thinking";
}

export function AgentThinkingOrb({
	parts,
	streaming,
	phase = null,
	showLabel = true,
}: {
	parts: AgentPart[];
	streaming: boolean;
	/** Backend loading phase; overrides part-derived activity while set. */
	phase?: AgentPhaseState | null;
	showLabel?: boolean;
}) {
	const { t } = useTranslation("agent");
	if (!streaming) return null;

	const activity = resolveActivity(parts);
	const orbState = phase
		? phaseToOrbState[phase.phase]
		: activityToOrbState[activity];
	let label: string;
	if (phase) {
		label = t(phaseLabelKey[phase.phase]);
		const detail = phase.detail?.trim();
		if (detail) label = `${label} ${detail}`;
	} else {
		label = t(activity);
	}

	const orb = (
		<ThinkingOrb
			state={orbState.state}
			size={20}
			theme="auto"
			aria-label={label}
		/>
	);

	if (!showLabel) {
		return orb;
	}

	return (
		<div className="inline-flex items-center gap-2 text-muted-foreground text-sm">
			{orb}
			<span>{label}</span>
		</div>
	);
}
