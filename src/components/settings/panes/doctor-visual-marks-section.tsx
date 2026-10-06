import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { errorText } from "@/lib/core/error";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import {
	type DoctorReport,
	doctorApplyVisualMarks,
	type VisualMarkCandidate,
} from "@/lib/doctor/api";
import { DoctorSection } from "./doctor-sections";

type VisualMarkDraft = VisualMarkCandidate & { selected: boolean };

function toVisualMarkDrafts(
	visualMarks: DoctorReport["visualMarks"] | undefined,
): VisualMarkDraft[] {
	return (visualMarks?.candidates ?? []).map((candidate) => ({
		...candidate,
		selected: candidate.selectedByDefault,
	}));
}

export function DoctorVisualMarksSection({
	vaultPath,
	visualMarks,
	onRefresh,
}: {
	vaultPath: string;
	visualMarks: DoctorReport["visualMarks"] | undefined;
	onRefresh: () => Promise<void>;
}) {
	const { t } = useTranslation("settings");
	const [visualDrafts, setVisualDrafts] = useState<VisualMarkDraft[]>(() =>
		toVisualMarkDrafts(visualMarks),
	);
	const [visualApplying, setVisualApplying] = useState(false);

	// A newly loaded report replaces the selectable drafts; re-seed during render
	// so no paint shows drafts that belong to a stale report.
	const [syncedVisualMarks, setSyncedVisualMarks] = useState(visualMarks);
	if (visualMarks !== syncedVisualMarks) {
		setSyncedVisualMarks(visualMarks);
		setVisualDrafts(toVisualMarkDrafts(visualMarks));
	}

	const selectedVisual = useMemo(
		() => visualDrafts.filter((draft) => draft.fixable && draft.selected),
		[visualDrafts],
	);

	const applyVisualMarks = async () => {
		if (!vaultPath || selectedVisual.length === 0) return;
		setVisualApplying(true);
		try {
			const result = await doctorApplyVisualMarks(
				vaultPath,
				selectedVisual.map((draft) => ({ path: draft.path })),
			);
			notifySuccess(
				t("doctor.visualMarks.success", {
					count: result.updatedPaths.length,
				}),
			);
			await onRefresh();
		} catch (error) {
			notifyError(errorText(error));
		} finally {
			setVisualApplying(false);
		}
	};

	return (
		<DoctorSection
			title={t("doctor.sections.visualMarks")}
			description={t("doctor.sectionHints.visualMarks")}
			ok={visualMarks?.ok ?? true}
			issueCount={visualMarks?.issues.length ?? 0}
			scrollable
			showDivider={false}
			action={
				selectedVisual.length > 0 ? (
					<Button
						type="button"
						size="sm"
						className="h-7 px-2 text-xs"
						disabled={visualApplying}
						onClick={() => void applyVisualMarks()}
					>
						{visualApplying
							? t("doctor.visualMarks.applying")
							: t("doctor.visualMarks.apply", {
									count: selectedVisual.length,
								})}
					</Button>
				) : undefined
			}
		>
			{visualDrafts.length > 0
				? visualDrafts.map((draft) => (
						<div
							key={draft.path}
							className="flex items-start gap-2 border-b px-3.5 py-2.5 last:border-b-0"
						>
							<Checkbox
								checked={draft.selected}
								disabled={!draft.fixable}
								aria-label={t("doctor.visualMarks.select", {
									path: draft.path,
								})}
								onCheckedChange={(checked) =>
									setVisualDrafts((current) =>
										current.map((item) =>
											item.path === draft.path
												? { ...item, selected: checked === true }
												: item,
										),
									)
								}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm">{draft.markId || draft.path}</p>
								<p className="truncate text-muted-foreground text-xs">
									{draft.path}
								</p>
								<p className="mt-0.5 text-muted-foreground text-xs">
									{draft.reason}
								</p>
							</div>
						</div>
					))
				: null}
		</DoctorSection>
	);
}
