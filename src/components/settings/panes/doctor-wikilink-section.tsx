import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { broadcastOpenAgentWithPrompt } from "@/lib/agent/composer-seed";
import { copyTextToClipboard } from "@/lib/core/clipboard";
import { errorText } from "@/lib/core/error";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import {
	type DoctorReport,
	doctorApplyWikilinks,
	doctorPlanWikilinks,
	type WikilinkRepairResidual,
	type WikilinkRepairSuggestion,
} from "@/lib/doctor/api";
import { buildDoctorWikilinkAgentPrompt } from "@/lib/doctor/wikilink-prompt";
import { closeSettingsWindow } from "@/lib/shell/settings-window";
import { DoctorSection, WikiIssueRows, WikiLinkDiff } from "./doctor-sections";

type WikilinkDraft = WikilinkRepairSuggestion & { selected: boolean };

export function DoctorWikilinkSection({
	vaultPath,
	wikilinks,
	planning,
	onPlanningChange,
	onRefresh,
}: {
	vaultPath: string;
	wikilinks: DoctorReport["wikilinks"] | undefined;
	/** Lifted so the pane header can disable refresh while a probe runs. */
	planning: boolean;
	onPlanningChange: (planning: boolean) => void;
	onRefresh: () => Promise<void>;
}) {
	const { t, i18n } = useTranslation("settings");
	const [wikiDrafts, setWikiDrafts] = useState<WikilinkDraft[]>([]);
	const [wikiResiduals, setWikiResiduals] = useState<WikilinkRepairResidual[]>(
		[],
	);
	const [wikiApplying, setWikiApplying] = useState(false);
	const [wikiConfirmOpen, setWikiConfirmOpen] = useState(false);
	const [wikiProgress, setWikiProgress] = useState<{
		percent: number;
		detail: string;
	} | null>(null);
	const [wikiReviewMode, setWikiReviewMode] = useState(false);

	// A newly loaded report invalidates the review list; drop it during render so
	// no paint ever mixes stale suggestions with fresh issues.
	const [syncedWikilinks, setSyncedWikilinks] = useState(wikilinks);
	if (wikilinks !== syncedWikilinks) {
		setSyncedWikilinks(wikilinks);
		setWikiDrafts([]);
		setWikiResiduals([]);
		setWikiReviewMode(false);
		setWikiProgress(null);
	}

	const wikiIssues = wikilinks?.issues ?? [];
	const selectedWiki = useMemo(
		() =>
			wikiDrafts.filter(
				(draft) =>
					draft.selected && draft.suggestedReplacement !== draft.expected,
			),
		[wikiDrafts],
	);

	const patchWikiDraft = (
		id: string,
		patch: Partial<Pick<WikilinkDraft, "selected" | "suggestedReplacement">>,
	) => {
		setWikiDrafts((current) =>
			current.map((draft) =>
				draft.id === id
					? {
							...draft,
							...patch,
							...(patch.suggestedReplacement !== undefined
								? { selected: patch.suggestedReplacement !== draft.expected }
								: {}),
						}
					: draft,
			),
		);
	};

	/** Deterministic plan only → review list + optional Agent prompt handoff. */
	const startWikiProbe = async () => {
		if (!vaultPath) return;
		onPlanningChange(true);
		setWikiReviewMode(false);
		setWikiProgress({ percent: 15, detail: t("doctor.wikilink.planning") });
		try {
			const plan = await doctorPlanWikilinks(vaultPath);
			const draftsFromPlan = plan.suggestions.map((item) => ({
				...item,
				// Manual rows stay unselected until the user edits/chooses them.
				selected: item.selectedByDefault,
			}));
			setWikiDrafts(draftsFromPlan);
			setWikiResiduals(plan.residuals);
			setWikiReviewMode(true);
			setWikiProgress(null);
			const autoCount = draftsFromPlan.filter(
				(item) => item.layer === "deterministic",
			).length;
			const manualCount = draftsFromPlan.filter(
				(item) => item.layer === "manual",
			).length;
			if (draftsFromPlan.length === 0) {
				notifyError(t("doctor.wikilink.noSuggestions"));
			} else {
				notifySuccess(
					t("doctor.wikilink.probeDone", {
						auto: autoCount,
						manual: manualCount,
						total: draftsFromPlan.length,
					}),
				);
			}
		} catch (error) {
			notifyError(errorText(error));
			setWikiProgress(null);
		} finally {
			onPlanningChange(false);
		}
	};

	const agentPrompt = useMemo(() => {
		if (!vaultPath || !wikiReviewMode) return "";
		if (wikiResiduals.length === 0 && wikiDrafts.length === 0) return "";
		return buildDoctorWikilinkAgentPrompt({
			vaultPath,
			residuals: wikiResiduals,
			suggestions: wikiDrafts,
			issues: wikilinks?.issues,
			language: i18n.resolvedLanguage ?? i18n.language,
		});
	}, [
		vaultPath,
		wikiReviewMode,
		wikiResiduals,
		wikiDrafts,
		wikilinks,
		i18n.resolvedLanguage,
		i18n.language,
	]);

	const copyAgentPrompt = async () => {
		if (!agentPrompt) return;
		await copyTextToClipboard(agentPrompt, {
			successMessage: t("doctor.wikilink.promptCopied"),
		});
	};

	const openAgentWithPrompt = () => {
		if (!agentPrompt) return;
		broadcastOpenAgentWithPrompt(agentPrompt);
		closeSettingsWindow();
	};

	const applyWiki = async () => {
		if (!vaultPath || selectedWiki.length === 0) return;
		setWikiApplying(true);
		try {
			const result = await doctorApplyWikilinks(
				vaultPath,
				selectedWiki.map((draft) => ({
					source: draft.source,
					rangeStart: draft.rangeStart,
					rangeEnd: draft.rangeEnd,
					expected: draft.expected,
					replacement: draft.suggestedReplacement,
					expectedHash: draft.expectedHash,
				})),
			);
			setWikiConfirmOpen(false);
			notifySuccess(
				t("doctor.wikilink.success", { count: result.updatedPaths.length }),
			);
			await onRefresh();
		} catch (error) {
			notifyError(errorText(error));
		} finally {
			setWikiApplying(false);
		}
	};

	const wikiAllSelected =
		selectedWiki.length > 0 &&
		wikiDrafts.every(
			(draft) =>
				draft.suggestedReplacement === draft.expected || draft.selected,
		);

	const toggleWikiSelectAll = () => {
		const next = !wikiAllSelected;
		setWikiDrafts((current) =>
			current.map((draft) => ({
				...draft,
				selected: next && draft.suggestedReplacement !== draft.expected,
			})),
		);
	};

	const wikiSectionAction = (() => {
		if (planning) {
			return (
				<Button type="button" size="sm" disabled>
					{t("doctor.wikilink.working")}
				</Button>
			);
		}
		if (wikiReviewMode && wikiDrafts.length > 0) {
			return (
				<div className="flex shrink-0 items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={toggleWikiSelectAll}
					>
						{wikiAllSelected
							? t("doctor.wikilink.deselectAll")
							: t("doctor.wikilink.selectAll")}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={selectedWiki.length === 0}
						onClick={() => setWikiConfirmOpen(true)}
					>
						{t("doctor.repair.apply")}
					</Button>
				</div>
			);
		}
		if (wikiIssues.length > 0) {
			return (
				<Button type="button" size="sm" onClick={() => void startWikiProbe()}>
					{t("doctor.wikilink.probe")}
				</Button>
			);
		}
		return undefined;
	})();

	return (
		<>
			<DoctorSection
				title={t("doctor.sections.wikilinks")}
				description={t("doctor.sectionHints.wikilinks")}
				ok={wikiIssues.length === 0}
				issueCount={wikiIssues.length}
				action={wikiSectionAction}
				scrollable
			>
				{planning || wikiProgress ? (
					<div className="space-y-2 px-3.5 py-3">
						<p className="text-muted-foreground text-xs">
							{wikiProgress?.detail ?? t("doctor.wikilink.planning")}
						</p>
						<Progress value={wikiProgress?.percent ?? 10} />
					</div>
				) : null}

				{wikiReviewMode ? (
					<>
						<p className="px-3.5 py-2 text-muted-foreground text-xs">
							{t("doctor.wikilink.editHint")}
						</p>
						{wikiDrafts.map((draft) => (
							<div
								key={draft.id}
								className="border-b px-3.5 py-3 last:border-b-0"
							>
								<div className="flex items-start gap-2">
									<Checkbox
										className="mt-0.5"
										checked={draft.selected}
										disabled={
											draft.suggestedReplacement === draft.expected ||
											wikiApplying
										}
										aria-label={t("doctor.wikilink.select", {
											source: draft.source,
										})}
										onCheckedChange={(checked) =>
											patchWikiDraft(draft.id, {
												selected: checked === true,
											})
										}
									/>
									<WikiLinkDiff
										source={draft.source}
										line={draft.line}
										prefix={draft.linePrefix}
										suffix={draft.lineSuffix}
										oldText={draft.expected}
										newText={draft.suggestedReplacement}
										newTextAriaLabel={t("doctor.wikilink.replacement")}
										onNewTextChange={(value) =>
											patchWikiDraft(draft.id, {
												suggestedReplacement: value,
											})
										}
									/>
								</div>
								{!!draft.candidates?.length && draft.editKind === "target" && (
									<select
										className="mt-2 w-full rounded-md border bg-background px-2 py-1 text-xs"
										aria-label={t("doctor.wikilink.chooseTarget")}
										value=""
										disabled={wikiApplying}
										onChange={(event) =>
											patchWikiDraft(draft.id, {
												suggestedReplacement: `/${event.target.value}`,
											})
										}
									>
										<option value="" disabled>
											{t("doctor.wikilink.chooseTarget")}
										</option>
										{draft.candidates.map((path) => (
											<option key={path} value={path}>
												{path}
											</option>
										))}
									</select>
								)}
							</div>
						))}
						{/* Residuals are already mirrored as manual suggestions; only used for Agent prompt. */}
						{wikiDrafts.length === 0 ? (
							<p className="px-3.5 py-3 text-muted-foreground text-xs">
								{t("doctor.wikilink.noSuggestions")}
							</p>
						) : null}
					</>
				) : wikiIssues.length > 0 ? (
					<WikiIssueRows issues={wikiIssues} />
				) : null}
			</DoctorSection>

			{wikiReviewMode && agentPrompt ? (
				<div className="mb-5 space-y-2 px-0.5">
					<p className="text-sm text-muted-foreground leading-relaxed">
						{t("doctor.wikilink.agentHint")}
					</p>
					<div className="overflow-hidden rounded-xl border bg-card">
						<div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
							<span className="font-medium text-muted-foreground text-xs">
								{t("doctor.wikilink.agentPromptLabel")}
							</span>
							<div className="flex items-center gap-1.5">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 px-2"
									onClick={() => void copyAgentPrompt()}
								>
									<Copy className="size-3.5" data-icon="inline-start" />
									{t("doctor.wikilink.copyPrompt")}
								</Button>
								<Button
									type="button"
									size="sm"
									className="h-7"
									onClick={openAgentWithPrompt}
								>
									{t("doctor.wikilink.openInAgent")}
								</Button>
							</div>
						</div>
						<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-caption leading-relaxed text-muted-foreground">
							{agentPrompt}
						</pre>
					</div>
				</div>
			) : null}

			<Dialog open={wikiConfirmOpen} onOpenChange={setWikiConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("doctor.wikilink.confirmTitle")}</DialogTitle>
						<DialogDescription>
							{t("doctor.wikilink.confirmDescription", {
								count: selectedWiki.length,
							})}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">{t("doctor.repair.cancel")}</Button>
						</DialogClose>
						<Button disabled={wikiApplying} onClick={() => void applyWiki()}>
							{wikiApplying
								? t("doctor.repair.applying")
								: t("doctor.repair.confirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
