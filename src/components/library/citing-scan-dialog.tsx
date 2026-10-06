import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLibraryStore } from "@/hooks/use-app-stores";
import { useOverlayRegistration } from "@/hooks/use-overlay-registration";
import { cn } from "@/lib/core/utils";
import type { CitingScanResult } from "@/lib/paper/refs";

/**
 * Candidates from a reverse-citation scan: new papers that cite the library
 * but are not imported yet. Nothing is preselected — every confirmed row
 * triggers a full metadata + asset download.
 */
export function CitingScanDialog({
	result,
	onCancel,
	onConfirm,
}: {
	result: CitingScanResult | null;
	onCancel: () => void;
	onConfirm: (identifiers: string[]) => Promise<void>;
}) {
	const { t } = useTranslation("sidebar");
	const open = result !== null;
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [shownResult, setShownResult] = useState(result);
	const [busy, setBusy] = useState(false);
	const paperMetaByRelPath = useLibraryStore((s) => s.paperMetaByRelPath);

	useOverlayRegistration("citing-scan", open, () => {
		if (!busy) onCancel();
	});

	// A fresh scan must not inherit the previous run's checkboxes.
	if (result !== shownResult) {
		setShownResult(result);
		setSelected(new Set());
	}

	const candidates = result?.candidates ?? [];
	const allSelected =
		candidates.length > 0 &&
		candidates.every((c) => selected.has(c.identifier));

	// Cited papers arrive as vault-relative paths; titles read better.
	const titleByPath = (path: string) =>
		paperMetaByRelPath.get(path)?.title ?? path.split("/").pop() ?? path;

	const toggle = (identifier: string, enabled: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (enabled) next.add(identifier);
			else next.delete(identifier);
			return next;
		});
	};

	const toggleAll = () => {
		setSelected(
			allSelected ? new Set() : new Set(candidates.map((c) => c.identifier)),
		);
	};

	const confirm = async () => {
		if (selected.size === 0 || busy) return;
		setBusy(true);
		try {
			await onConfirm([...selected]);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<DialogContent
				className="w-[min(42rem,calc(100vw-2rem))] max-w-none overflow-hidden sm:max-w-none"
				aria-describedby={undefined}
			>
				<DialogHeader>
					<DialogTitle>{t("papersLibrary.citingTitle")}</DialogTitle>
				</DialogHeader>

				{candidates.length === 0 ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						{t("papersLibrary.citingEmpty", { date: result?.sinceDate ?? "" })}
					</p>
				) : (
					<>
						<div className="flex min-w-0 items-center justify-between gap-2 px-0.5">
							<span className="truncate text-muted-foreground text-xs">
								{t("papersLibrary.citingSummary", {
									seeds: result?.seedsTotal ?? 0,
									raw: result?.rawCiting ?? 0,
									shown: candidates.length,
								})}
							</span>
							<button
								type="button"
								className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
								onClick={toggleAll}
								disabled={busy}
							>
								{allSelected
									? t("papersLibrary.citingSelectNone")
									: t("papersLibrary.citingSelectAll")}
							</button>
						</div>
						{/* DialogContent is a grid: children need min-w-0 or their
						    min-content width wins and the rows spill out of the card. */}
						<ScrollArea className="max-h-[min(60vh,30rem)] w-full min-w-0">
							<div className="w-full min-w-0 space-y-2 pr-3">
								{candidates.map((candidate) => {
									const checkboxId = `citing-${candidate.s2Id}`;
									const checked = selected.has(candidate.identifier);
									const cites = candidate.citedByMine
										.map(titleByPath)
										.join(" · ");
									return (
										<label
											key={candidate.s2Id}
											htmlFor={checkboxId}
											className={cn(
												"flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
												checked
													? "border-primary/50 bg-accent/50"
													: "bg-card hover:bg-accent/40",
												busy && "pointer-events-none opacity-60",
											)}
										>
											<Checkbox
												id={checkboxId}
												className="mt-0.5"
												checked={checked}
												disabled={busy}
												onCheckedChange={(value) =>
													toggle(candidate.identifier, value === true)
												}
											/>
											<span className="min-w-0 flex-1 space-y-1">
												<span className="block font-medium text-sm leading-snug">
													{candidate.title}
												</span>
												{/* line-clamp, not truncate: truncate's nowrap would
												    inflate min-content and widen the whole dialog. */}
												<span className="line-clamp-1 block text-muted-foreground text-xs">
													{candidate.date} ·{" "}
													{t("papersLibrary.citingCites", {
														count: candidate.citedByMine.length,
													})}{" "}
													· {cites}
												</span>
											</span>
										</label>
									);
								})}
							</div>
						</ScrollArea>
					</>
				)}

				<DialogFooter>
					<Button variant="ghost" onClick={onCancel} disabled={busy}>
						{t("papersLibrary.citingCancel")}
					</Button>
					<Button
						className="gap-1.5"
						onClick={() => void confirm()}
						disabled={busy || selected.size === 0}
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Download className="size-4" />
						)}
						{t("papersLibrary.citingConfirm", { count: selected.size })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
