import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useOverlayRegistration } from "@/hooks/use-overlay-registration";
import { cn } from "@/lib/core/utils";
import type { SkillDiscovery } from "@/lib/paper/lookup";

export function SkillImportDialog({
	discoveries,
	onCancel,
	onConfirm,
}: {
	discoveries: SkillDiscovery[] | null;
	onCancel: () => void;
	onConfirm: (
		selections: Array<{ discoveryId: string; selectedNames: string[] }>,
	) => Promise<void>;
}) {
	const { t } = useTranslation("sidebar");
	const open = discoveries !== null;
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);

	useOverlayRegistration("skill-import", open, () => {
		if (!busy) onCancel();
	});

	useEffect(() => {
		if (!discoveries) {
			setSelected(new Set());
			return;
		}
		const next = new Set<string>();
		for (const discovery of discoveries) {
			for (const candidate of discovery.candidates) {
				if (!candidate.alreadyInstalled) {
					next.add(`${discovery.discoveryId}:${candidate.name}`);
				}
			}
		}
		setSelected(next);
	}, [discoveries]);

	const selectedCount = selected.size;

	const toggle = (key: string, enabled: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (enabled) next.add(key);
			else next.delete(key);
			return next;
		});
	};

	const toggleGroup = (discovery: SkillDiscovery) => {
		const keys = discovery.candidates.map(
			(candidate) => `${discovery.discoveryId}:${candidate.name}`,
		);
		const allSelected = keys.every((key) => selected.has(key));
		setSelected((prev) => {
			const next = new Set(prev);
			for (const key of keys) {
				if (allSelected) next.delete(key);
				else next.add(key);
			}
			return next;
		});
	};

	const confirm = async () => {
		if (!discoveries || selectedCount === 0 || busy) return;
		setBusy(true);
		try {
			await onConfirm(
				discoveries.map((discovery) => ({
					discoveryId: discovery.discoveryId,
					selectedNames: discovery.candidates
						.filter((candidate) =>
							selected.has(`${discovery.discoveryId}:${candidate.name}`),
						)
						.map((candidate) => candidate.name),
				})),
			);
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
				className="w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-hidden sm:max-w-none"
				aria-describedby={undefined}
			>
				<DialogHeader>
					<DialogTitle>{t("lookup.skillImportTitle")}</DialogTitle>
				</DialogHeader>
				<ScrollArea className="max-h-[min(60vh,28rem)]">
					<div className="space-y-4 pr-3">
						{discoveries?.map((discovery) => {
							const keys = discovery.candidates.map(
								(candidate) => `${discovery.discoveryId}:${candidate.name}`,
							);
							const allSelected =
								keys.length > 0 && keys.every((key) => selected.has(key));
							return (
								<div key={discovery.discoveryId} className="space-y-2">
									<div className="flex items-center justify-between gap-2 px-0.5">
										<span
											className="truncate font-medium text-muted-foreground text-xs"
											title={discovery.source}
										>
											{discovery.source}
										</span>
										<button
											type="button"
											className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
											onClick={() => toggleGroup(discovery)}
											disabled={busy || keys.length === 0}
										>
											{allSelected
												? t("lookup.skillImportSelectNone")
												: t("lookup.skillImportSelectAll")}
										</button>
									</div>
									<div className="space-y-2">
										{discovery.candidates.map((candidate) => {
											const key = `${discovery.discoveryId}:${candidate.name}`;
											const checkboxId = `skill-import-${key}`;
											const checked = selected.has(key);
											return (
												<label
													key={key}
													htmlFor={checkboxId}
													className={cn(
														"flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
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
															toggle(key, value === true)
														}
													/>
													<span className="min-w-0 flex-1 space-y-1">
														<span className="flex items-center gap-2">
															<span className="truncate font-medium text-sm">
																{candidate.name}
															</span>
															{candidate.alreadyInstalled ? (
																<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
																	{t("lookup.skillImportInstalled")}
																</span>
															) : null}
														</span>
													</span>
												</label>
											);
										})}
									</div>
								</div>
							);
						})}
					</div>
				</ScrollArea>
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel} disabled={busy}>
						{t("lookup.skillImportCancel")}
					</Button>
					<Button
						className="gap-1.5"
						onClick={() => void confirm()}
						disabled={busy || selectedCount === 0}
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Download className="size-4" />
						)}
						{t("lookup.skillImportConfirm", { count: selectedCount })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
