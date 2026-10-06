import { EyeOff } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { errorText } from "@/lib/core/error";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import {
	type AliasRepairCandidate,
	type DoctorReport,
	doctorApplyAliases,
	doctorIgnoreAliases,
} from "@/lib/doctor/api";
import { DoctorSection } from "./doctor-sections";

type CandidateDraft = AliasRepairCandidate & { selected: boolean };

function toAliasDrafts(
	aliases: DoctorReport["aliases"] | undefined,
): CandidateDraft[] {
	return (aliases?.candidates ?? []).map((candidate) => ({
		...candidate,
		selected: candidate.selectedByDefault,
	}));
}

export function DoctorAliasSection({
	vaultPath,
	aliases,
	onRefresh,
}: {
	vaultPath: string;
	aliases: DoctorReport["aliases"] | undefined;
	onRefresh: () => Promise<void>;
}) {
	const { t } = useTranslation("settings");
	const [drafts, setDrafts] = useState<CandidateDraft[]>(() =>
		toAliasDrafts(aliases),
	);
	const [applying, setApplying] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

	// A newly loaded report replaces the editable drafts; re-seed during render so
	// no paint shows drafts that belong to a stale report.
	const [syncedAliases, setSyncedAliases] = useState(aliases);
	if (aliases !== syncedAliases) {
		setSyncedAliases(aliases);
		setDrafts(toAliasDrafts(aliases));
	}

	const aliasIssues = aliases?.issues ?? [];
	const ignoredAliasPaths = aliases?.ignoredPaths ?? [];
	const selected = useMemo(
		() => drafts.filter((draft) => draft.fixable && draft.selected),
		[drafts],
	);

	const patchDraft = (
		path: string,
		patch: Partial<
			Pick<CandidateDraft, "selected" | "titleAlias" | "shortAlias">
		>,
	) => {
		setDrafts((current) =>
			current.map((draft) =>
				draft.path === path ? { ...draft, ...patch } : draft,
			),
		);
	};

	const apply = async () => {
		if (!vaultPath || selected.length === 0) return;
		setApplying(true);
		try {
			const result = await doctorApplyAliases(
				vaultPath,
				selected.map((draft) => ({
					path: draft.path,
					titleAlias: draft.titleAlias,
					shortAlias: draft.shortAlias,
					expectedHash: draft.expectedHash,
				})),
			);
			setConfirmOpen(false);
			notifySuccess(
				t("doctor.repair.success", { count: result.updatedPaths.length }),
			);
			await onRefresh();
		} catch (error) {
			notifyError(errorText(error));
		} finally {
			setApplying(false);
		}
	};

	const ignorePaths = async (paths: string[], ignore: boolean) => {
		if (!vaultPath || paths.length === 0) return;
		try {
			await doctorIgnoreAliases(vaultPath, paths, ignore);
			notifySuccess(
				ignore
					? t("doctor.repair.ignored", { count: paths.length })
					: t("doctor.repair.restored", { count: paths.length }),
			);
			await onRefresh();
		} catch (error) {
			notifyError(errorText(error));
		}
	};

	const aliasIssueCount =
		drafts.length +
		aliasIssues.filter(
			(issue) => !drafts.some((draft) => draft.path === issue.path),
		).length;
	const hasFixableAliases = drafts.some((draft) => draft.fixable);

	return (
		<>
			<DoctorSection
				title={t("doctor.sections.aliases")}
				description={t("doctor.sectionHints.aliases")}
				ok={aliases?.ok ?? true}
				issueCount={aliasIssueCount}
				action={
					hasFixableAliases ? (
						<div className="flex shrink-0 items-center gap-2">
							{selected.length > 0 ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() =>
										void ignorePaths(
											selected.map((draft) => draft.path),
											true,
										)
									}
								>
									{t("doctor.repair.ignoreSelected")}
								</Button>
							) : null}
							<Button
								type="button"
								size="sm"
								disabled={selected.length === 0}
								onClick={() => setConfirmOpen(true)}
							>
								{t("doctor.repair.apply")}
							</Button>
						</div>
					) : undefined
				}
				scrollable
				showDivider={false}
			>
				{drafts.length > 0 ||
				aliasIssues.length > 0 ||
				ignoredAliasPaths.length > 0 ? (
					<>
						{drafts.map((draft) => (
							<div
								key={draft.path}
								className="border-b px-3.5 py-3 last:border-b-0"
							>
								<div className="mb-2 flex items-start gap-2">
									<Checkbox
										checked={draft.selected}
										disabled={!draft.fixable}
										aria-label={t("doctor.repair.select", {
											path: draft.path,
										})}
										onCheckedChange={(checked) =>
											patchDraft(draft.path, { selected: checked === true })
										}
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm">{draft.paperTitle}</p>
										<p className="truncate text-muted-foreground text-xs">
											{draft.path}
										</p>
									</div>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="size-7 shrink-0"
												aria-label={t("doctor.repair.ignore", {
													path: draft.path,
												})}
												onClick={() => void ignorePaths([draft.path], true)}
											>
												<EyeOff className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											{t("doctor.repair.ignoreHint")}
										</TooltipContent>
									</Tooltip>
								</div>
								{draft.fixable ? (
									<div className="grid gap-2 pl-6">
										<div className="grid gap-1">
											<Label className="text-muted-foreground text-xs">
												{t("doctor.repair.titleAlias")}
											</Label>
											<Input
												aria-label={t("doctor.repair.titleAlias")}
												value={draft.titleAlias}
												onChange={(event) =>
													patchDraft(draft.path, {
														titleAlias: event.currentTarget.value,
													})
												}
											/>
										</div>
										<div className="grid gap-1">
											<Label className="text-muted-foreground text-xs">
												{t("doctor.repair.shortAlias")}
											</Label>
											<Input
												aria-label={t("doctor.repair.shortAlias")}
												value={draft.shortAlias}
												onChange={(event) =>
													patchDraft(draft.path, {
														shortAlias: event.currentTarget.value,
													})
												}
											/>
										</div>
										{draft.currentAliases.length > 0 ? (
											<p className="text-muted-foreground text-xs">
												{t("doctor.repair.preserved", {
													aliases: draft.currentAliases.join(", "),
												})}
											</p>
										) : null}
									</div>
								) : (
									<p className="pl-6 text-amber-700 text-xs dark:text-amber-400">
										{draft.reason ?? t("doctor.repair.manual")}
									</p>
								)}
							</div>
						))}
						{aliasIssues
							.filter(
								(issue) => !drafts.some((draft) => draft.path === issue.path),
							)
							.map((issue) => (
								<div
									key={`${issue.code}:${issue.path ?? ""}:${issue.message}`}
									className="border-b px-3.5 py-2.5 last:border-b-0"
								>
									<div className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											<p className="text-sm leading-snug">{issue.message}</p>
											{issue.path ? (
												<p className="mt-0.5 truncate text-muted-foreground text-xs">
													{issue.path}
												</p>
											) : null}
										</div>
										{issue.path ? (
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														type="button"
														variant="ghost"
														size="icon"
														className="size-7 shrink-0"
														aria-label={t("doctor.repair.ignore", {
															path: issue.path,
														})}
														onClick={() =>
															void ignorePaths([issue.path as string], true)
														}
													>
														<EyeOff className="size-3.5" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{t("doctor.repair.ignoreHint")}
												</TooltipContent>
											</Tooltip>
										) : null}
									</div>
								</div>
							))}
						{ignoredAliasPaths.length > 0 ? (
							<div className="border-b px-3.5 py-2.5 last:border-b-0">
								<div className="mb-1.5 flex items-center justify-between gap-2">
									<p className="text-muted-foreground text-xs">
										{t("doctor.repair.ignoredCount", {
											count: ignoredAliasPaths.length,
										})}
									</p>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 px-2 text-xs"
										onClick={() => void ignorePaths(ignoredAliasPaths, false)}
									>
										{t("doctor.repair.restoreAll")}
									</Button>
								</div>
								<ul className="space-y-1">
									{ignoredAliasPaths.map((path) => (
										<li
											key={path}
											className="flex items-center gap-2 text-muted-foreground text-xs"
										>
											<span className="min-w-0 flex-1 truncate">{path}</span>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-6 shrink-0 px-1.5 text-xs"
												onClick={() => void ignorePaths([path], false)}
											>
												{t("doctor.repair.restore")}
											</Button>
										</li>
									))}
								</ul>
							</div>
						) : null}
					</>
				) : null}
			</DoctorSection>

			<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("doctor.repair.confirmTitle")}</DialogTitle>
						<DialogDescription>
							{t("doctor.repair.confirmDescription", {
								count: selected.length,
							})}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">{t("doctor.repair.cancel")}</Button>
						</DialogClose>
						<Button disabled={applying} onClick={() => void apply()}>
							{applying
								? t("doctor.repair.applying")
								: t("doctor.repair.confirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
