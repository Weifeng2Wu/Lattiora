import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AgentModelSelects,
	useAgentModelCatalog,
} from "@/components/settings/agent-model-picker";
import {
	PROVIDER_INPUT_CLASS,
	ProbeDot,
	ProviderCard,
	ProviderCardHeader,
	ProviderFieldRow,
} from "@/components/settings/provider-card";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import { useBuiltinProviderAvailable } from "@/components/settings/use-builtin-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cloudAiError } from "@/lib/cloud/ai";
import { BUILTIN_PROVIDER_ID } from "@/lib/core/builtin";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import { openExternalUrl } from "@/lib/core/open-external";
import type {
	AppSettings,
	CommercialTranslateProviderId,
	TranslateProviderConfig,
	TranslateProviderId,
	TranslateTargetLang,
} from "@/lib/settings";
import { saveSettingsAsync } from "@/lib/settings";
import {
	COMMERCIAL_MT_DEFAULT_BASE_URLS,
	COMMERCIAL_MT_DOCS_URLS,
	COMMERCIAL_MT_PROVIDER_IDS,
	DEFAULT_TRANSLATE_PROMPT_TEMPLATE,
	type FreeMtProbeStatus,
	hasTranslateApiKey,
	isCommercialProviderConfigured,
	isCommercialTranslateProvider,
	isFreeMtProvider,
	isTranslateApiKeyMask,
	listSelectableProviders,
	maskTranslateApiKey,
	probeCommercialMtProvider,
} from "@/lib/translate";
import { invokeTranslateText } from "@/lib/translate/api";
import {
	EMPTY_TRANSLATE_PROVIDER_CONFIG,
	translateBaseUrl,
} from "@/lib/translate/defaults";
import type { ProbeStatus } from "@/lib/ui/probe-status";

/** Resolve API key for save/probe: draft wins; otherwise keep stored (may be mask). */
function resolveApiKeyDraft(draft: string | undefined, stored: string): string {
	if (draft !== undefined) return draft.trim();
	return stored.trim();
}

type ProviderStatusKind = FreeMtProbeStatus | "unconfigured" | "configured";

const PROBE_LABEL_KEYS = {
	ok: "translate.provider.probeOk",
	fail: "translate.provider.probeFail",
	probing: "translate.provider.probeProbing",
	idle: "translate.provider.probeIdle",
} as const satisfies Record<ProbeStatus, string>;

function ProviderStatusDot({
	kind,
	label,
}: {
	kind: ProviderStatusKind;
	label: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<ProbeDot
					status={
						kind === "unconfigured" || kind === "configured" ? "idle" : kind
					}
					className={kind === "configured" ? "bg-emerald-500" : undefined}
					configured={kind !== "unconfigured"}
					label={label}
				/>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

export function TranslatePane({
	settings,
	patch,
	onOpenAgentSettings,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
	onOpenAgentSettings?: () => void;
}) {
	const { t } = useTranslation(["settings", "cloud"]);
	const tr = settings.translate;
	const builtinAvailable = useBuiltinProviderAvailable();
	const patchTranslate = useCallback(
		(partial: Partial<typeof tr>) =>
			patch({ translate: { ...tr, ...partial } }),
		[patch, tr],
	);
	const showAgent = tr.provider === "agent";
	const getProviderConfig = useCallback(
		(id: CommercialTranslateProviderId): TranslateProviderConfig =>
			tr.providerConfigs[id] ?? EMPTY_TRANSLATE_PROVIDER_CONFIG,
		[tr.providerConfigs],
	);
	/**
	 * Free MT + Agent always; commercial only when configured (or currently
	 * selected). The built-in shows only when its key is compiled in, or when it
	 * is the stored selection (so a carried-over setting stays visible/disable-able).
	 */
	const providers = useMemo(
		() =>
			listSelectableProviders().filter((s) => {
				if (s.id === BUILTIN_PROVIDER_ID) {
					return builtinAvailable || tr.provider === s.id;
				}
				if (!isCommercialTranslateProvider(s.id)) return true;
				if (tr.provider === s.id) return true;
				return isCommercialProviderConfigured(s.id, getProviderConfig(s.id));
			}),
		[builtinAvailable, getProviderConfig, tr.provider],
	);
	const [providerProbeMap, setProviderProbeMap] = useState<
		Partial<Record<TranslateProviderId, ProbeStatus>>
	>({});
	const providerProbeAbortRef = useRef<
		Partial<Record<TranslateProviderId, AbortController>>
	>({});
	const resetProbe = useCallback((provider: TranslateProviderId) => {
		providerProbeAbortRef.current[provider]?.abort();
		setProviderProbeMap((prev) => ({ ...prev, [provider]: "idle" }));
	}, []);
	/** In-progress edits (API key, base URL, …) not written until Confirm. */
	const [configDrafts, setConfigDrafts] = useState<
		Partial<
			Record<CommercialTranslateProviderId, Partial<TranslateProviderConfig>>
		>
	>({});
	const setDraftField = useCallback(
		(
			providerId: CommercialTranslateProviderId,
			partial: Partial<TranslateProviderConfig>,
		) => {
			resetProbe(providerId);
			setConfigDrafts((prev) => ({
				...prev,
				[providerId]: { ...prev[providerId], ...partial },
			}));
		},
		[resetProbe],
	);

	const agentModelValue = useMemo(
		() => ({ agentId: tr.agentId, modelId: tr.modelId }),
		[tr.agentId, tr.modelId],
	);
	const onAgentModelChange = useCallback(
		(next: { agentId: string; modelId: string }) => {
			patchTranslate(next);
		},
		[patchTranslate],
	);
	const agentModelCatalog = useAgentModelCatalog({
		active: showAgent,
		value: agentModelValue,
		onChange: onAgentModelChange,
	});

	const [selectedProbing, setSelectedProbing] = useState(false);
	const testSelectedProvider = async () => {
		const provider = tr.provider;
		providerProbeAbortRef.current[provider]?.abort();
		const ac = new AbortController();
		providerProbeAbortRef.current[provider] = ac;
		setSelectedProbing(true);
		setProviderProbeMap((prev) => ({ ...prev, [provider]: "probing" }));
		try {
			await invokeTranslateText({
				...tr.providerConfigs[tr.provider as CommercialTranslateProviderId],
				provider: tr.provider,
				text: "Hello",
				sourceLang: "en",
				targetLang: "zh-CN",
				model: isCommercialTranslateProvider(tr.provider)
					? tr.providerConfigs[tr.provider]?.model
					: tr.modelId,
				timeoutMs: 30000,
				signal: ac.signal,
			});
			if (ac.signal.aborted) return;
			setProviderProbeMap((prev) => ({ ...prev, [provider]: "ok" }));
			notifySuccess(t("cloud:settings.connectionOk"));
		} catch (error) {
			if (ac.signal.aborted) return;
			setProviderProbeMap((prev) => ({ ...prev, [provider]: "fail" }));
			notifyError(cloudAiError(error));
		} finally {
			if (providerProbeAbortRef.current[provider] === ac)
				delete providerProbeAbortRef.current[provider];
			setSelectedProbing(false);
		}
	};

	const runCommercialProbe = useCallback(
		(
			providerId: CommercialTranslateProviderId,
			configOverride?: TranslateProviderConfig,
		) => {
			const config = configOverride ?? getProviderConfig(providerId);
			if (!isCommercialProviderConfigured(providerId, config)) {
				setProviderProbeMap((prev) => ({ ...prev, [providerId]: "idle" }));
				return;
			}

			providerProbeAbortRef.current[providerId]?.abort();
			const ac = new AbortController();
			providerProbeAbortRef.current[providerId] = ac;
			setProviderProbeMap((prev) => ({
				...prev,
				[providerId]: "probing",
			}));

			void probeCommercialMtProvider(providerId, {
				config,
				signal: ac.signal,
			})
				.then((ok) => {
					if (ac.signal.aborted) return;
					setProviderProbeMap((prev) => ({
						...prev,
						[providerId]: ok ? "ok" : "fail",
					}));
				})
				.catch(() => {
					if (ac.signal.aborted) return;
					setProviderProbeMap((prev) => ({
						...prev,
						[providerId]: "fail",
					}));
				})
				.finally(() => {
					if (providerProbeAbortRef.current[providerId] === ac) {
						delete providerProbeAbortRef.current[providerId];
					}
				});
		},
		[getProviderConfig],
	);

	/** Confirm: persist drafts (key encrypted by the Worker), mask UI, then probe. */
	const confirmCommercialProvider = useCallback(
		async (providerId: CommercialTranslateProviderId) => {
			const stored = getProviderConfig(providerId);
			const draft = configDrafts[providerId];
			const draftOrStored = resolveApiKeyDraft(draft?.apiKey, stored.apiKey);
			// Retype → new plaintext; still showing mask → send mask so Host merge keeps secret.
			const toSave: TranslateProviderConfig = {
				...stored,
				...draft,
				apiKey: draftOrStored,
			};
			if (!isCommercialProviderConfigured(providerId, toSave)) {
				setProviderProbeMap((prev) => ({ ...prev, [providerId]: "idle" }));
				return;
			}

			const displayMask = isTranslateApiKeyMask(toSave.apiKey)
				? toSave.apiKey
				: maskTranslateApiKey(toSave.apiKey);
			const nextTranslate = {
				...tr,
				providerConfigs: {
					...tr.providerConfigs,
					[providerId]: toSave,
				},
			};
			const maskedCfg: TranslateProviderConfig = {
				...toSave,
				apiKey: displayMask,
			};

			try {
				// Write real key (or mask-merge) to the Worker before probe.
				await saveSettingsAsync({
					...settings,
					translate: nextTranslate,
				});
			} catch (error) {
				notifyError(cloudAiError(error));
				return;
			}

			setConfigDrafts((prev) => {
				const next = { ...prev };
				delete next[providerId];
				return next;
			});

			// React state shows same-length `*` only; second save merges mask → keep secret.
			patch({
				translate: {
					...nextTranslate,
					providerConfigs: {
						...nextTranslate.providerConfigs,
						[providerId]: maskedCfg,
					},
				},
			});

			runCommercialProbe(providerId, maskedCfg);
		},
		[configDrafts, getProviderConfig, patch, runCommercialProbe, settings, tr],
	);

	useEffect(() => {
		return () => {
			for (const ac of Object.values(providerProbeAbortRef.current)) {
				ac?.abort();
			}
		};
	}, []);

	return (
		<>
			<PageTitle title={t("translate.title")} />
			<SettingsGroup>
				<SettingsRow label={t("translate.provider.label")}>
					<div className="flex items-center gap-2">
						<Select
							value={tr.provider}
							onValueChange={(v) =>
								patchTranslate({ provider: v as TranslateProviderId })
							}
						>
							<SelectTrigger size="sm" className="min-w-[200px] max-w-[280px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="max-h-72">
								{providers.map((s) => {
									const isBuiltin = s.id === BUILTIN_PROVIDER_ID;
									const configured =
										s.id === "agent" || isBuiltin
											? builtinAvailable
											: isCommercialTranslateProvider(s.id)
												? isCommercialProviderConfigured(
														s.id,
														getProviderConfig(s.id),
													)
												: Boolean(
														translateBaseUrl(
															s.id,
															tr.providerConfigs[s.id]?.baseUrl,
														),
													);
									const status = providerProbeMap[s.id] ?? "idle";
									const kind: ProviderStatusKind = !configured
										? "unconfigured"
										: status === "idle"
											? "configured"
											: status;
									const statusLabel = t(
										kind === "unconfigured"
											? "translate.providerConfig.notConfigured"
											: kind === "configured"
												? "translate.providerConfig.configured"
												: PROBE_LABEL_KEYS[kind],
									);
									return (
										<SelectItem
											key={s.id}
											value={s.id}
											disabled={isBuiltin && !builtinAvailable}
										>
											<span className="flex min-w-0 items-center gap-1.5">
												<ProviderStatusDot kind={kind} label={statusLabel} />
												<span className="truncate">
													{t(
														`translate.provider.${s.nameKey}` as "translate.provider.google",
													)}
												</span>
											</span>
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
						<Button
							type="button"
							variant="outline"
							size="xs"
							disabled={selectedProbing}
							onClick={() => void testSelectedProvider()}
						>
							{t("cloud:settings.testConnection")}
						</Button>
					</div>
				</SettingsRow>
				{isFreeMtProvider(tr.provider) &&
				tr.provider !== BUILTIN_PROVIDER_ID ? (
					<SettingsRow
						label={t("translate.providerConfig.baseUrl.label")}
						htmlFor="translate-free-endpoint"
					>
						<Input
							id="translate-free-endpoint"
							value={
								tr.providerConfigs[tr.provider]?.baseUrl ??
								translateBaseUrl(tr.provider)
							}
							onChange={(event) => {
								resetProbe(tr.provider);
								patchTranslate({
									providerConfigs: {
										...tr.providerConfigs,
										[tr.provider]: {
											...EMPTY_TRANSLATE_PROVIDER_CONFIG,
											...tr.providerConfigs[tr.provider],
											baseUrl: event.target.value,
										},
									},
								});
							}}
							placeholder={translateBaseUrl(tr.provider) || "https://"}
							className={PROVIDER_INPUT_CLASS}
							spellCheck={false}
						/>
					</SettingsRow>
				) : null}
				<SettingsRow label={t("translate.targetLang.label")}>
					<Select
						value={tr.targetLang}
						onValueChange={(v) =>
							patchTranslate({ targetLang: v as TranslateTargetLang })
						}
					>
						<SelectTrigger size="sm" className="min-w-[160px] max-w-[220px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ui">{t("translate.targetLang.ui")}</SelectItem>
							<SelectItem value="en">{t("translate.targetLang.en")}</SelectItem>
							<SelectItem value="zh-CN">
								{t("translate.targetLang.zhCN")}
							</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					label={t("translate.autoSelection.label")}
					htmlFor="translate-auto-selection"
				>
					<Switch
						id="translate-auto-selection"
						checked={tr.autoTranslateSelection}
						onCheckedChange={(v) =>
							patchTranslate({ autoTranslateSelection: v })
						}
					/>
				</SettingsRow>
				<SettingsRow
					label={t("translate.dualPane.label")}
					htmlFor="translate-dual-pane"
				>
					<Switch
						id="translate-dual-pane"
						checked={tr.dualPaneTranslate}
						onCheckedChange={(v) => patchTranslate({ dualPaneTranslate: v })}
					/>
				</SettingsRow>
			</SettingsGroup>

			<div className="mb-5">
				<h3 className="mb-2 px-0.5 font-medium text-sm">
					{t("translate.providerConfig.section")}
				</h3>
				<div className="grid gap-2">
					{COMMERCIAL_MT_PROVIDER_IDS.map((id) => {
						const cfg = getProviderConfig(id);
						const draft = configDrafts[id];
						const draftKey = draft?.apiKey;
						const displayApiKey =
							draftKey !== undefined
								? draftKey
								: hasTranslateApiKey(cfg.apiKey)
									? isTranslateApiKeyMask(cfg.apiKey)
										? cfg.apiKey
										: maskTranslateApiKey(cfg.apiKey)
									: "";
						const effectiveCfg: TranslateProviderConfig = {
							...cfg,
							...draft,
							apiKey: resolveApiKeyDraft(draftKey, cfg.apiKey),
						};
						const configured = isCommercialProviderConfigured(id, effectiveCfg);
						const status = providerProbeMap[id] ?? "idle";
						const statusKind: ProviderStatusKind = configured
							? status === "idle"
								? "configured"
								: status
							: "unconfigured";
						const statusLabel = configured
							? t(
									status === "idle"
										? "translate.providerConfig.configured"
										: PROBE_LABEL_KEYS[status],
								)
							: t("translate.providerConfig.notConfigured");
						const inputPrefix = `translate-provider-${id}`;
						return (
							<ProviderCard key={id} provider={id}>
								<ProviderCardHeader
									left={
										<>
											<ProviderStatusDot
												kind={statusKind}
												label={statusLabel}
											/>
											<p className="min-w-0 truncate font-medium text-sm">
												{t(
													`translate.provider.${id}` as "translate.provider.google",
												)}
											</p>
											<Button
												type="button"
												variant="link"
												size="xs"
												className="-ml-1.5 h-auto shrink-0 px-1.5 text-primary"
												onClick={() =>
													openExternalUrl(COMMERCIAL_MT_DOCS_URLS[id])
												}
											>
												<ExternalLink
													data-icon="inline-start"
													className="size-3"
												/>
												{t("translate.providerConfig.openDocsLabel")}
											</Button>
										</>
									}
									right={
										<div className="flex gap-2">
											<Button
												type="button"
												variant="outline"
												size="xs"
												disabled={!configured || status === "probing"}
												onClick={() =>
													runCommercialProbe(id, {
														...cfg,
														...draft,
														apiKey: displayApiKey,
													})
												}
											>
												{t("cloud:settings.testConnection")}
											</Button>
											<Button
												type="button"
												variant="outline"
												size="xs"
												disabled={!configured || status === "probing"}
												onClick={() => void confirmCommercialProvider(id)}
											>
												{t("translate.providerConfig.confirm")}
											</Button>
										</div>
									}
								/>

								<div className="grid gap-1.5">
									<ProviderFieldRow
										label={t("translate.providerConfig.apiKey.label")}
										htmlFor={`${inputPrefix}-api-key`}
									>
										<Input
											id={`${inputPrefix}-api-key`}
											type="password"
											value={displayApiKey}
											onChange={(e) => {
												const next = e.target.value;
												const shownMask =
													draftKey === undefined &&
													hasTranslateApiKey(cfg.apiKey)
														? isTranslateApiKeyMask(cfg.apiKey)
															? cfg.apiKey
															: maskTranslateApiKey(cfg.apiKey)
														: null;
												// Typing over the mask starts a fresh draft (not mask + chars).
												if (
													shownMask != null &&
													(next === shownMask || next.startsWith(shownMask))
												) {
													const stripped = next.startsWith(shownMask)
														? next.slice(shownMask.length)
														: next;
													setDraftField(id, { apiKey: stripped });
													return;
												}
												setDraftField(id, { apiKey: next });
											}}
											onFocus={(e) => {
												// Select mask so the next keystroke replaces it entirely.
												if (
													draftKey === undefined &&
													hasTranslateApiKey(cfg.apiKey)
												) {
													e.currentTarget.select();
												}
											}}
											placeholder={t(
												"translate.providerConfig.apiKey.placeholder",
											)}
											className={PROVIDER_INPUT_CLASS}
											spellCheck={false}
											autoComplete="off"
										/>
									</ProviderFieldRow>
									<ProviderFieldRow
										label={t("translate.providerConfig.baseUrl.label")}
										htmlFor={`${inputPrefix}-base-url`}
									>
										<Input
											id={`${inputPrefix}-base-url`}
											value={effectiveCfg.baseUrl}
											onChange={(e) =>
												setDraftField(id, { baseUrl: e.target.value })
											}
											onBlur={() => {
												const trimmed = effectiveCfg.baseUrl
													.trim()
													.replace(/\/+$/, "");
												if (trimmed !== effectiveCfg.baseUrl) {
													setDraftField(id, { baseUrl: trimmed });
												}
											}}
											placeholder={COMMERCIAL_MT_DEFAULT_BASE_URLS[id]}
											className={PROVIDER_INPUT_CLASS}
											spellCheck={false}
											autoComplete="off"
										/>
									</ProviderFieldRow>
									{id === "azure" ? (
										<ProviderFieldRow
											label={t("translate.providerConfig.region.label")}
											htmlFor={`${inputPrefix}-region`}
										>
											<Input
												id={`${inputPrefix}-region`}
												value={effectiveCfg.region}
												onChange={(e) =>
													setDraftField(id, {
														region: e.target.value,
													})
												}
												placeholder={t(
													"translate.providerConfig.region.placeholder",
												)}
												className={PROVIDER_INPUT_CLASS}
												spellCheck={false}
												autoComplete="off"
											/>
										</ProviderFieldRow>
									) : null}
									{id === "openaiCompatible" ? (
										<ProviderFieldRow
											label={t("translate.providerConfig.model.label")}
											htmlFor={`${inputPrefix}-model`}
										>
											<Input
												id={`${inputPrefix}-model`}
												value={effectiveCfg.model}
												onChange={(e) =>
													setDraftField(id, {
														model: e.target.value,
													})
												}
												placeholder={t(
													"translate.providerConfig.model.placeholder",
												)}
												className={PROVIDER_INPUT_CLASS}
												spellCheck={false}
												autoComplete="off"
											/>
										</ProviderFieldRow>
									) : null}
								</div>
							</ProviderCard>
						);
					})}
				</div>
			</div>

			<div className="mb-5">
				<div className="mb-2 flex items-center justify-between gap-2 px-0.5">
					<h3 className="font-medium text-sm">
						{t("translate.customPrompt.label")}
					</h3>
					<div className="flex items-center gap-1.5">
						<Button
							type="button"
							variant="outline"
							size="xs"
							disabled={tr.customPrompt === DEFAULT_TRANSLATE_PROMPT_TEMPLATE}
							onClick={() =>
								patchTranslate({
									customPrompt: DEFAULT_TRANSLATE_PROMPT_TEMPLATE,
								})
							}
						>
							{t("translate.customPrompt.seed")}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="xs"
							disabled={!tr.customPrompt}
							onClick={() => patchTranslate({ customPrompt: "" })}
						>
							{t("translate.customPrompt.reset")}
						</Button>
					</div>
				</div>
				<SettingsGroup>
					<div className="flex flex-col gap-1.5 px-3.5 py-2.5">
						<Textarea
							id="translate-custom-prompt"
							value={tr.customPrompt}
							onChange={(e) =>
								patchTranslate({
									customPrompt: e.target.value.slice(0, 8000),
								})
							}
							onBlur={() => {
								const trimmed = tr.customPrompt.trim();
								if (trimmed !== tr.customPrompt) {
									patchTranslate({ customPrompt: trimmed });
								}
							}}
							placeholder={t("translate.customPrompt.placeholder")}
							rows={5}
							className="min-h-[110px] resize-y font-mono text-xs placeholder:text-muted-foreground/50"
							spellCheck={true}
						/>
					</div>
				</SettingsGroup>
			</div>

			{showAgent && (
				<>
					<SettingsGroup>
						{agentModelCatalog.availableAgents.length === 0 ? (
							<div className="flex flex-col gap-2 px-3.5 py-2.5">
								<p className="text-muted-foreground text-xs leading-relaxed">
									{t("translate.agentId.empty")}
								</p>
								{onOpenAgentSettings && (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="w-fit"
										onClick={onOpenAgentSettings}
									>
										{t("translate.agentId.openAgentSettings")}
									</Button>
								)}
							</div>
						) : (
							<AgentModelSelects
								value={agentModelValue}
								onChange={onAgentModelChange}
								agentSelectValue={agentModelCatalog.agentSelectValue}
								modelSelectValue={agentModelCatalog.modelSelectValue}
								availableAgents={agentModelCatalog.availableAgents}
								defaultAgent={agentModelCatalog.defaultAgent}
								models={agentModelCatalog.models}
								agentLabel={t("translate.agentId.label")}
								modelLabel={t("translate.modelId.label")}
								followDefaultLabel={t("translate.agentId.followDefault")}
								followDefaultNamedLabel={(name) =>
									t("translate.agentId.followDefaultNamed", { name })
								}
								followModelLabel={t("translate.modelId.followAgent")}
							/>
						)}
					</SettingsGroup>
					{agentModelCatalog.availableAgents.length > 0 &&
					agentModelCatalog.models.length === 0 ? (
						<p className="mb-3 px-0.5 text-muted-foreground text-xs leading-relaxed">
							{t("translate.modelId.needWarm")}
						</p>
					) : null}
				</>
			)}
		</>
	);
}
