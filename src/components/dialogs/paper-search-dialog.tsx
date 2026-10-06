import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useOverlayRegistration } from "@/hooks/use-overlay-registration";
import { cn } from "@/lib/core/utils";
import type { PaperSearchCandidate } from "@/lib/paper/lookup";
import type { PaperSearchDraftGroup } from "@/lib/shell/ui-store";

/** Shows the head of the title-search queue; picking one imports it. */
export function PaperSearchDialog({
	groups,
	onCancel,
	onConfirm,
}: {
	groups: PaperSearchDraftGroup[] | null;
	onCancel: () => void;
	onConfirm: (
		candidate: PaperSearchCandidate,
		parentDir: string,
	) => Promise<void>;
}) {
	const { t } = useTranslation("sidebar");
	const group = groups?.[0] ?? null;
	const open = group !== null;
	const pending = Boolean(group?.pending);
	const [pick, setPick] = useState<{ query: string; index: number } | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const selected = pick && pick.query === group?.query ? pick.index : 0;

	useOverlayRegistration("paper-search", open, () => {
		if (!busy) onCancel();
	});

	const confirm = async () => {
		const candidate = group?.candidates[selected];
		if (!group || !candidate || busy || pending) return;
		setBusy(true);
		try {
			await onConfirm(candidate, group.parentDir);
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
			{/*
			  Avoid Radix ScrollArea here: its viewport content wrapper uses
			  display:table, which grows to intrinsic text width and lets long
			  titles burst past the card (#438). A plain overflow-y-auto keeps
			  width constrained to the dialog.
			*/}
			<DialogContent
				className="w-[min(36rem,calc(100vw-2rem))] min-w-0 max-w-none overflow-hidden sm:max-w-none"
				aria-describedby={undefined}
			>
				<DialogHeader className="min-w-0 pr-8">
					<DialogTitle className="min-w-0 break-words leading-snug">
						{t("lookup.searchTitle", { query: group?.query ?? "" })}
					</DialogTitle>
				</DialogHeader>
				<div className="max-h-[min(60vh,28rem)] w-full min-w-0 overflow-x-hidden overflow-y-auto">
					<div className="w-full min-w-0 space-y-2 pr-1">
						{pending
							? (["a", "b", "c"] as const).map((slot) => (
									<div
										key={`pending-${slot}`}
										className="flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-card p-3"
									>
										<Skeleton className="library-shimmer h-4 w-11/12" />
										<Skeleton className="library-shimmer h-3 w-2/3" />
										<Skeleton className="library-shimmer h-3 w-1/3" />
									</div>
								))
							: group?.candidates.map((candidate, index) => {
									const checked = index === selected;
									const meta = [
										candidate.authors.slice(0, 3).join(", "),
										candidate.year?.toString(),
										candidate.venue,
									]
										.filter(Boolean)
										.join(" · ");
									return (
										<button
											key={candidate.identifier}
											type="button"
											onClick={() => setPick({ query: group.query, index })}
											disabled={busy}
											className={cn(
												"flex w-full min-w-0 flex-col gap-1 overflow-hidden rounded-lg border p-3 text-left transition-colors",
												checked
													? "border-primary/50 bg-accent/50"
													: "bg-card hover:bg-accent/40",
												busy && "pointer-events-none opacity-60",
											)}
										>
											<span className="break-words font-medium text-sm leading-snug">
												{candidate.title}
											</span>
											{meta ? (
												<span className="break-words text-muted-foreground text-xs leading-snug">
													{meta}
												</span>
											) : null}
											<span className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground text-xs">
												<span className="max-w-full break-all rounded bg-muted px-1.5 py-0.5 font-mono text-caption">
													{candidate.arxivId
														? `arXiv:${candidate.arxivId}`
														: candidate.doi}
												</span>
												{candidate.citationCount != null ? (
													<span>
														{t("lookup.searchCitations", {
															count: candidate.citationCount,
														})}
													</span>
												) : null}
											</span>
										</button>
									);
								})}
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel} disabled={busy}>
						{t("lookup.searchCancel")}
					</Button>
					<Button
						className="gap-1.5"
						onClick={() => void confirm()}
						disabled={busy || pending || !group?.candidates.length}
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Download className="size-4" />
						)}
						{t("lookup.searchConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
