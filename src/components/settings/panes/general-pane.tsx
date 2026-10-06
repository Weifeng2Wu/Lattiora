import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitHubMirrorRow } from "@/components/settings/agent-common-rows";
import { ScholarServiceCard } from "@/components/settings/scholar-service-card";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import { StatusDot } from "@/components/settings/status-dot";
import type { SettingsHostContext } from "@/components/settings/types";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { clearUsage } from "@/lib/activity";
import { errorText } from "@/lib/core/error";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import {
	type EasyScholarProbeStatus,
	hasEasyScholarKey,
	isEasyScholarKeyMask,
	maskEasyScholarKey,
	probeEasyScholarKey,
} from "@/lib/easyscholar";
import {
	PAPER_TREE_LABEL_MODES,
	PAPER_TREE_SORT_MODES,
	type PaperTreeLabelMode,
	type PaperTreeSortMode,
} from "@/lib/paper";
import {
	type AppSettings,
	AUTO_UPDATE_INTERNAL_LINKS,
	type AutoUpdateInternalLinks,
	PAPER_NOTE_MODES,
	type PaperNoteMode,
	saveSettingsAsync,
} from "@/lib/settings";
import {
	NOTES_TEMPLATE_PATH,
	notesTemplateSeed,
} from "@/lib/vault/note-template";
import { openPath } from "@/lib/workspace/actions";

export function GeneralPane({
	settings,
	patch,
	hostContext,
	vaultPath = null,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
	hostContext: SettingsHostContext;
	vaultPath?: string | null;
}) {
	const { t } = useTranslation(["settings", "cloud"]);
	const [easyScholarKeyDraft, setEasyScholarKeyDraft] = useState(
		settings.easyScholarKey,
	);
	const [seedingTemplate, setSeedingTemplate] = useState(false);

	// Custom note mode seeds `.agentero/templates/NOTES.md` in the active vault;
	// remote vaults have no local template file to create.
	const canSeedTemplate = Boolean(vaultPath) && hostContext.kind === "local";

	const seedTemplate = async () => {
		if (!vaultPath || !canSeedTemplate) return;
		setSeedingTemplate(true);
		try {
			const res = await notesTemplateSeed(vaultPath);
			openPath(`/cloud/${NOTES_TEMPLATE_PATH}`);
			notifySuccess(
				t(
					res.created
						? "general.paperNoteMode.seedCreated"
						: "general.paperNoteMode.seedExists",
				),
			);
		} catch (e) {
			notifyError(errorText(e));
		} finally {
			setSeedingTemplate(false);
		}
	};

	useEffect(() => {
		setEasyScholarKeyDraft(settings.easyScholarKey);
	}, [settings.easyScholarKey]);

	return (
		<>
			<PageTitle title={t("general.title")} />
			{hostContext.kind === "remote" ? (
				<p className="mb-3 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-muted-foreground text-xs leading-relaxed">
					{t("host.remoteContextHint", {
						host: hostContext.label,
						path: hostContext.remotePath || "—",
					})}
				</p>
			) : null}
			<ScholarServiceCard settings={settings} />
			<ScholarServiceCard settings={settings} service="recognizer" />
			<ScholarServiceCard settings={settings} service="translator" />
			<SettingsGroup>
				<SettingsRow label={t("general.paperTreeLabelMode.label")}>
					<Select
						value={settings.paperTreeLabelMode}
						onValueChange={(v) =>
							patch({ paperTreeLabelMode: v as PaperTreeLabelMode })
						}
					>
						<SelectTrigger size="sm" className="min-w-[180px] max-w-[240px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAPER_TREE_LABEL_MODES.map((mode) => (
								<SelectItem key={mode} value={mode}>
									{t(`general.paperTreeLabelMode.${mode}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("general.paperTreeSortMode.label")}>
					<Select
						value={settings.paperTreeSortMode}
						onValueChange={(v) =>
							patch({ paperTreeSortMode: v as PaperTreeSortMode })
						}
					>
						<SelectTrigger size="sm" className="min-w-[180px] max-w-[240px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAPER_TREE_SORT_MODES.map((mode) => (
								<SelectItem key={mode} value={mode}>
									{t(`general.paperTreeSortMode.${mode}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					label={t("general.allowFileExtensionRename.label")}
					htmlFor="allow-file-extension-rename"
				>
					<Switch
						id="allow-file-extension-rename"
						checked={settings.allowFileExtensionRename}
						onCheckedChange={(v) => patch({ allowFileExtensionRename: v })}
					/>
				</SettingsRow>
				<SettingsRow label={t("general.paperNoteMode.label")}>
					<Select
						value={settings.paperNoteMode}
						onValueChange={(v) => patch({ paperNoteMode: v as PaperNoteMode })}
					>
						<SelectTrigger size="sm" className="min-w-[180px] max-w-[240px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAPER_NOTE_MODES.map((mode) => (
								<SelectItem key={mode} value={mode}>
									{t(`general.paperNoteMode.${mode}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				{settings.paperNoteMode === "custom" ? (
					<SettingsRow
						label={
							<code className="font-mono text-muted-foreground text-xs">
								.agentero/templates/NOTES.md
							</code>
						}
					>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={seedingTemplate || !canSeedTemplate}
									aria-label={t("general.paperNoteMode.seed")}
									onClick={() => void seedTemplate()}
								>
									{t("general.paperNoteMode.seed")}
								</Button>
							</TooltipTrigger>
							<TooltipContent>{t("general.paperNoteMode.seed")}</TooltipContent>
						</Tooltip>
					</SettingsRow>
				) : null}
				<SettingsRow
					label={t("general.autoOpenPaperNotes.label")}
					htmlFor="auto-open-paper-notes"
				>
					<Switch
						id="auto-open-paper-notes"
						checked={settings.autoOpenPaperNotes}
						onCheckedChange={(v) => patch({ autoOpenPaperNotes: v })}
					/>
				</SettingsRow>
				<SettingsRow
					label={t("general.autoIngest.label")}
					htmlFor="auto-ingest"
				>
					<Switch
						id="auto-ingest"
						checked={settings.autoIngest}
						onCheckedChange={(v) => patch({ autoIngest: v })}
					/>
				</SettingsRow>
				<SettingsRow
					label={t("general.replaceCurrentTabOnOpenPaper.label")}
					htmlFor="replace-current-tab-on-open-paper"
				>
					<Switch
						id="replace-current-tab-on-open-paper"
						checked={settings.replaceCurrentTabOnOpenPaper}
						onCheckedChange={(v) => patch({ replaceCurrentTabOnOpenPaper: v })}
					/>
				</SettingsRow>
				<SettingsRow label={t("general.autoUpdateInternalLinks.label")}>
					<Select
						value={settings.autoUpdateInternalLinks}
						onValueChange={(value) =>
							patch({
								autoUpdateInternalLinks: value as AutoUpdateInternalLinks,
							})
						}
					>
						<SelectTrigger size="sm" className="min-w-[180px] max-w-[240px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{AUTO_UPDATE_INTERNAL_LINKS.map((mode) => (
								<SelectItem key={mode} value={mode}>
									{t(`general.autoUpdateInternalLinks.${mode}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("general.batchImportConcurrency.label")}>
					<Select
						value={String(settings.batchImportConcurrency)}
						onValueChange={(value) =>
							patch({ batchImportConcurrency: Number(value) })
						}
					>
						<SelectTrigger size="sm" className="min-w-[180px] max-w-[240px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Array.from({ length: 10 }, (_, index) => index + 1).map(
								(value) => (
									<SelectItem key={value} value={String(value)}>
										{t("general.batchImportConcurrency.value", { value })}
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("general.plaza.label")} htmlFor="plaza-enabled">
					<Switch
						id="plaza-enabled"
						checked={settings.plazaEnabled}
						onCheckedChange={(v) => patch({ plazaEnabled: v })}
					/>
				</SettingsRow>
				<GitHubMirrorRow
					htmlFor="github-mirror-enabled"
					label={t("general.githubMirror.label")}
					description={t("general.githubMirror.description")}
					value={settings.githubMirrorBaseUrl}
					enabled={settings.githubMirrorEnabled}
					onValueChange={(githubMirrorBaseUrl) =>
						patch({ githubMirrorBaseUrl })
					}
					onToggle={(githubMirrorEnabled) => patch({ githubMirrorEnabled })}
				/>
			</SettingsGroup>
			<EasyScholarSettingsBlock
				savedKey={settings.easyScholarKey}
				keyDraft={easyScholarKeyDraft}
				onKeyDraftChange={setEasyScholarKeyDraft}
				onCommitKey={async (value) => {
					const trimmed = value.trim();
					const next = await saveSettingsAsync({
						...settings,
						easyScholarKey: trimmed,
					});
					setEasyScholarKeyDraft(next.easyScholarKey);
				}}
			/>
			<ExportSettingsBlock settings={settings} patch={patch} />
			<PrivacySettingsBlock settings={settings} patch={patch} />
		</>
	);
}

function EasyScholarSettingsBlock({
	savedKey,
	keyDraft,
	onKeyDraftChange,
	onCommitKey,
}: {
	savedKey: string;
	keyDraft: string;
	onKeyDraftChange: (value: string) => void;
	onCommitKey: (value: string) => Promise<void>;
}) {
	const { t } = useTranslation(["settings", "cloud"]);
	const [status, setStatus] = useState<EasyScholarProbeStatus>("idle");
	const abortRef = useRef<AbortController | null>(null);

	const runProbe = useCallback(async () => {
		if (!hasEasyScholarKey(savedKey)) {
			setStatus("idle");
			return;
		}
		abortRef.current?.abort();
		const ac = new AbortController();
		abortRef.current = ac;
		setStatus("probing");
		const ok = await probeEasyScholarKey(ac.signal);
		if (ac.signal.aborted) return;
		setStatus(ok ? "ok" : "fail");
	}, [savedKey]);

	useEffect(() => {
		void runProbe();
		return () => {
			abortRef.current?.abort();
		};
	}, [runProbe]);

	const changed = useMemo(() => {
		const saved = savedKey.trim();
		const draft = keyDraft.trim();
		if (!saved && !draft) return false;
		if (!saved || !draft) return true;
		return draft !== saved;
	}, [savedKey, keyDraft]);

	const handleConfirm = async () => {
		try {
			await onCommitKey(keyDraft.trim());
		} catch (error) {
			notifyError(errorText(error));
		}
	};

	const statusLabel = t(
		status === "idle"
			? "general.easyScholar.probeIdle"
			: status === "probing"
				? "general.easyScholar.probeProbing"
				: status === "ok"
					? "general.easyScholar.probeOk"
					: "general.easyScholar.probeFail",
	);

	return (
		<div className="mt-4">
			<p className="mb-2 px-0.5 font-medium text-sm">
				{t("general.easyScholar.section")}
			</p>
			<SettingsGroup>
				<SettingsRow
					label={
						<span className="inline-flex items-center gap-1.5">
							{t("general.easyScholar.keyLabel")}
							<StatusDot tone={probeTone(status)} label={statusLabel} />
						</span>
					}
					htmlFor="easy-scholar-key"
				>
					<div className="flex items-center gap-2">
						<Input
							id="easy-scholar-key"
							type="password"
							autoComplete="off"
							placeholder={t("general.easyScholar.placeholder")}
							className="h-8 w-64 max-w-[18rem] font-mono text-xs"
							value={keyDraft}
							onChange={(e) => {
								const next = e.currentTarget.value;
								const shownMask = hasEasyScholarKey(savedKey)
									? isEasyScholarKeyMask(savedKey)
										? savedKey
										: maskEasyScholarKey(savedKey)
									: null;
								if (
									shownMask != null &&
									(next === shownMask || next.startsWith(shownMask))
								) {
									onKeyDraftChange(next.slice(shownMask.length));
								} else {
									onKeyDraftChange(next);
								}
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									void handleConfirm();
								}
							}}
						/>
						<Button
							type="button"
							variant="outline"
							size="xs"
							disabled={!changed || status === "probing"}
							onClick={() => void handleConfirm()}
						>
							{t("general.easyScholar.confirm")}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="xs"
							disabled={!savedKey || changed || status === "probing"}
							onClick={() => void runProbe()}
						>
							{t("cloud:settings.testConnection")}
						</Button>
					</div>
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}

function probeTone(
	status: EasyScholarProbeStatus,
): "ok" | "idle" | "warn" | "err" {
	switch (status) {
		case "ok":
			return "ok";
		case "probing":
			return "warn";
		case "fail":
			return "err";
		default:
			return "idle";
	}
}

function PrivacySettingsBlock({
	settings: _settings,
	patch: _patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation(["settings", "cloud"]);
	return (
		<div className="mt-4">
			<p className="mb-2 px-0.5 font-medium text-sm">
				{t("general.privacy.section")}
			</p>
			<SettingsGroup>
				<SettingsRow
					label={t("general.privacy.telemetry.label")}
					htmlFor="telemetry-enabled"
					description={t("cloud:settings.noTelemetry")}
				>
					<Switch id="telemetry-enabled" checked={false} disabled />
				</SettingsRow>
				<SettingsRow label={t("general.privacy.clearUsage.label")}>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => {
							void clearUsage()
								.then(() => notifySuccess(t("general.privacy.clearUsage.done")))
								.catch((e) => notifyError(errorText(e)));
						}}
					>
						{t("general.privacy.clearUsage.action")}
					</Button>
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}

function ExportSettingsBlock({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation(["settings", "cloud"]);
	return (
		<div className="mt-4">
			<p className="mb-2 px-0.5 font-medium text-sm">
				{t("general.export.section")}
			</p>
			<SettingsGroup>
				<SettingsRow
					label={t("general.export.watermark.label")}
					htmlFor="export-watermark-enabled"
				>
					<Switch
						id="export-watermark-enabled"
						checked={settings.exportWatermarkEnabled}
						onCheckedChange={(v) => patch({ exportWatermarkEnabled: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}
