import { type ReactNode, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	type AgentListResponse,
	listAgents,
	loadModelCatalog,
} from "@/lib/agent";
import { ensureModelsInclude } from "@/lib/agent/chat-state";
import { getAiConfig } from "@/lib/cloud/ai";
import { listAvailableAgents } from "@/lib/translate";
import { SettingsRow } from "./settings-layout";

/** Select sentinel: empty agentId/modelId means “follow app default”. */
export const FOLLOW_DEFAULT_AGENT = "__follow_default__";
export const FOLLOW_DEFAULT_MODEL = "__follow_model__";

export type AgentModelValue = {
	agentId: string;
	modelId: string;
};

/**
 * Load agent registry (optional) + model catalog for the resolved agent.
 * Clears stale agentId via onChange when the agent is gone; free-form model ids
 * outside the advertised ACP catalog are kept (third-party / gateway; #216).
 */
export function useAgentModelCatalog({
	active = true,
	value,
	onChange,
	/** Controlled registry; when set, skips internal listAgents. */
	registry: registryProp,
	/** Bump to re-fetch listAgents (e.g. after catalog rescan). Ignored if registryProp is set. */
	registryRefreshKey,
}: {
	active?: boolean;
	value: AgentModelValue;
	onChange: (next: AgentModelValue) => void;
	registry?: AgentListResponse | null;
	registryRefreshKey?: unknown;
}) {
	const controlled = registryProp !== undefined;
	const [internalRegistry, setInternalRegistry] =
		useState<AgentListResponse | null>(null);
	const [models, setModels] = useState<{ id: string; name: string }[]>([]);

	const registry = controlled ? (registryProp ?? null) : internalRegistry;

	// biome-ignore lint/correctness/useExhaustiveDependencies: registryRefreshKey intentionally re-fetches listAgents
	useEffect(() => {
		if (controlled || !active) {
			if (!controlled && !active) setInternalRegistry(null);
			return;
		}
		let cancelled = false;
		const refresh = () => {
			void listAgents()
				.then((r) => {
					if (!cancelled) setInternalRegistry(r);
				})
				.catch(() => {
					if (!cancelled) setInternalRegistry(null);
				});
		};
		refresh();
		window.addEventListener("cloud:ai-config", refresh);
		return () => {
			window.removeEventListener("cloud:ai-config", refresh);
			cancelled = true;
		};
	}, [controlled, active, registryRefreshKey]);

	const availableAgents = listAvailableAgents(registry);
	const defaultAgent = registry?.defaultId
		? (availableAgents.find((a) => a.id === registry.defaultId) ??
			registry.agents.find((a) => a.id === registry.defaultId))
		: undefined;
	const resolvedAgentId = value.agentId.trim() || registry?.defaultId || "";

	// Warm + load catalog on agent change only. Custom modelId is merged below so
	// free-form pins (third-party / gateway) stay visible without re-warming.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally omit value.modelId
	useEffect(() => {
		if (!active || !resolvedAgentId) {
			setModels([]);
			return;
		}
		const pinnedModelId = value.modelId;
		const cached = loadModelCatalog(resolvedAgentId);
		setModels(
			ensureModelsInclude(cached?.models ?? [], [
				pinnedModelId,
				cached?.currentId,
			]),
		);
		let cancelled = false;
		void getAiConfig()
			.then((config) => {
				if (!cancelled && config)
					setModels((prev) =>
						ensureModelsInclude(prev, [config.model, pinnedModelId]),
					);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [active, resolvedAgentId]);

	// Keep custom / third-party modelId in the select options without re-warming.
	useEffect(() => {
		if (!active || !value.modelId?.trim()) return;
		setModels((prev) => ensureModelsInclude(prev, [value.modelId]));
	}, [active, value.modelId]);

	// Drop stale agentId only. Do not clear free-form model ids missing from the
	// advertised ACP catalog (third-party / gateway models; #216).
	useEffect(() => {
		if (!active || !registry) return;
		if (value.agentId && !availableAgents.some((a) => a.id === value.agentId)) {
			onChange({ agentId: "", modelId: "" });
		}
	}, [active, registry, availableAgents, value.agentId, onChange]);

	const agentSelectValue = value.agentId.trim()
		? value.agentId
		: FOLLOW_DEFAULT_AGENT;
	const modelSelectValue = value.modelId.trim()
		? value.modelId
		: FOLLOW_DEFAULT_MODEL;

	return {
		registry,
		models,
		availableAgents,
		defaultAgent,
		resolvedAgentId,
		agentSelectValue,
		modelSelectValue,
	};
}

export type AgentModelSelectsProps = {
	value: AgentModelValue;
	onChange: (next: AgentModelValue) => void;
	agentSelectValue: string;
	modelSelectValue: string;
	availableAgents: { id: string; name: string }[];
	defaultAgent?: { id: string; name: string };
	models: { id: string; name: string }[];
	agentLabel: string;
	modelLabel: string;
	followDefaultLabel: string;
	followDefaultNamedLabel: (name: string) => string;
	followModelLabel: string;
};

/** Dual Select rows only (caller wraps SettingsGroup / empty / needWarm). */
export function AgentModelSelects({
	value,
	onChange,
	agentSelectValue,
	modelSelectValue,
	availableAgents,
	defaultAgent,
	models,
	agentLabel,
	modelLabel,
	followDefaultLabel,
	followDefaultNamedLabel,
	followModelLabel,
}: AgentModelSelectsProps) {
	return (
		<>
			<SettingsRow label={agentLabel}>
				<Select
					value={agentSelectValue}
					onValueChange={(v) => {
						if (v === FOLLOW_DEFAULT_AGENT) {
							onChange({ agentId: "", modelId: "" });
						} else {
							onChange({ agentId: v, modelId: "" });
						}
					}}
				>
					<SelectTrigger size="sm" className="min-w-[200px] max-w-[280px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={FOLLOW_DEFAULT_AGENT}>
							{defaultAgent?.name
								? followDefaultNamedLabel(defaultAgent.name)
								: followDefaultLabel}
						</SelectItem>
						{availableAgents.map((a) => (
							<SelectItem key={a.id} value={a.id}>
								{a.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</SettingsRow>
			<SettingsRow label={modelLabel}>
				<Select
					value={modelSelectValue}
					onValueChange={(v) => {
						onChange({
							agentId: value.agentId,
							modelId: v === FOLLOW_DEFAULT_MODEL ? "" : v,
						});
					}}
				>
					<SelectTrigger size="sm" className="min-w-[200px] max-w-[280px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={FOLLOW_DEFAULT_MODEL}>
							{followModelLabel}
						</SelectItem>
						{models.map((m) => (
							<SelectItem key={m.id} value={m.id}>
								{m.name || m.id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Input
					aria-label={modelLabel}
					className="h-8 max-w-[200px] text-xs"
					value={value.modelId}
					placeholder={followModelLabel}
					onChange={(event) =>
						onChange({ ...value, modelId: event.target.value })
					}
				/>
			</SettingsRow>
		</>
	);
}

export type AgentModelPickerProps = {
	active?: boolean;
	value: AgentModelValue;
	onChange: (next: AgentModelValue) => void;
	registry?: AgentListResponse | null;
	registryRefreshKey?: unknown;
	agentLabel: string;
	modelLabel: string;
	followDefaultLabel: string;
	followDefaultNamedLabel: (name: string) => string;
	followModelLabel: string;
	/** Shown instead of selects when no agents. */
	emptyState?: ReactNode;
};

/** Hook + dual Select; emptyState when no available agents. */
export function AgentModelPicker({
	active = true,
	value,
	onChange,
	registry,
	registryRefreshKey,
	agentLabel,
	modelLabel,
	followDefaultLabel,
	followDefaultNamedLabel,
	followModelLabel,
	emptyState,
}: AgentModelPickerProps) {
	const catalog = useAgentModelCatalog({
		active,
		value,
		onChange,
		registry,
		registryRefreshKey,
	});

	if (!active) return null;

	if (catalog.availableAgents.length === 0) {
		return emptyState ?? null;
	}

	return (
		<AgentModelSelects
			value={value}
			onChange={onChange}
			agentSelectValue={catalog.agentSelectValue}
			modelSelectValue={catalog.modelSelectValue}
			availableAgents={catalog.availableAgents}
			defaultAgent={catalog.defaultAgent}
			models={catalog.models}
			agentLabel={agentLabel}
			modelLabel={modelLabel}
			followDefaultLabel={followDefaultLabel}
			followDefaultNamedLabel={followDefaultNamedLabel}
			followModelLabel={followModelLabel}
		/>
	);
}
