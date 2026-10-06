import { CheckCheck, Download, GitCompareArrows, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cloudAiError } from "@/lib/cloud/ai";
import { downloadBlob } from "@/lib/cloud/backup";
import {
	type ConflictBatchResult,
	compareConflictText,
	conflictTextSupported,
	conflictVersionExists,
	type FileConflict,
	listFileConflicts,
	resolveFileConflict,
	resolveIdenticalFileConflicts,
} from "@/lib/cloud/conflicts";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import { notifyError } from "@/lib/core/notify";

function ConflictReview({
	conflict,
	onResolved,
}: {
	conflict: FileConflict;
	onResolved: () => void;
}) {
	const { t } = useTranslation("cloud");
	const [texts, setTexts] = useState<[string, string] | null>(null);
	const [choices, setChoices] = useState<
		Record<number, "current" | "recovered">
	>({});
	const [busy, setBusy] = useState(false);
	const textSupported = conflictTextSupported(conflict);
	useEffect(() => {
		let active = true;
		if (textSupported)
			Promise.all(
				[conflict.current, conflict.recovered].map(async (file) =>
					conflictVersionExists(file) ? await file!.data!.text() : "",
				),
			)
				.then(([left, right]) => {
					if (active) setTexts([left, right]);
				})
				.catch((error) => notifyError(cloudAiError(error)));
		return () => {
			active = false;
		};
	}, [conflict, textSupported]);
	const chunks = useMemo(
		() => (texts ? compareConflictText(...texts) : []),
		[texts],
	);
	const resolve = async (choice: "current" | "recovered" | "merged") => {
		setBusy(true);
		try {
			const merged = chunks
				.map((chunk, i) => chunk[choices[i] ?? "current"])
				.join("");
			await resolveFileConflict(conflict, choice, merged);
			onResolved();
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="min-w-0 space-y-3" aria-busy={busy}>
			<p className="break-all font-medium text-sm">{conflict.path}</p>
			<div className="grid grid-cols-2 gap-3">
				{(["current", "recovered"] as const).map((side) => {
					const file = conflict[side];
					return (
						<div key={side} className="min-w-0 rounded-md border p-3">
							<h3 className="font-medium text-sm">{t(`conflicts.${side}`)}</h3>
							<p className="text-muted-foreground text-xs">
								{conflictVersionExists(file)
									? `${new Date(file!.updated_at).toLocaleString()} · ${(file!.size / 1024).toFixed(1)} KB`
									: t("conflicts.deleted")}
							</p>
							{file?.data && !file.deleted && (
								<Button
									className="mt-2"
									size="sm"
									variant="outline"
									onClick={() =>
										downloadBlob(
											file.data!,
											`${side}-${conflict.path.split("/").at(-1)}`,
										)
									}
								>
									<Download className="size-3.5" />
									{t("conflicts.download")}
								</Button>
							)}
						</div>
					);
				})}
			</div>
			{textSupported ? (
				texts ? (
					<section
						className="max-h-[40vh] overflow-auto rounded-md border"
						aria-label={t("conflicts.differences")}
					>
						{chunks.map((chunk, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: The compared snapshot is immutable and chunks never reorder.
								key={i}
								className={chunk.changed ? "border-y border-amber-500/40" : ""}
							>
								{chunk.changed ? (
									<>
										<div className="flex flex-wrap items-center gap-2 bg-muted px-2 py-1">
											<span className="mr-auto text-xs">
												{t("conflicts.change", {
													count: chunks.slice(0, i + 1).filter((c) => c.changed)
														.length,
												})}
											</span>
											{(["current", "recovered"] as const).map((side) => (
												<Button
													key={side}
													disabled={busy}
													size="sm"
													variant={
														(choices[i] ?? "current") === side
															? "default"
															: "outline"
													}
													aria-pressed={(choices[i] ?? "current") === side}
													onClick={() =>
														setChoices((old) => ({ ...old, [i]: side }))
													}
												>
													{t(`conflicts.${side}`)}
												</Button>
											))}
										</div>
										<div className="grid grid-cols-2 divide-x">
											<pre className="min-w-0 whitespace-pre-wrap break-words bg-red-500/10 p-2 font-mono text-xs">
												{chunk.current || t("conflicts.empty")}
											</pre>
											<pre className="min-w-0 whitespace-pre-wrap break-words bg-emerald-500/10 p-2 font-mono text-xs">
												{chunk.recovered || t("conflicts.empty")}
											</pre>
										</div>
									</>
								) : (
									<details className="p-2 text-xs text-muted-foreground">
										<summary className="cursor-pointer">
											{t("conflicts.unchanged")}
										</summary>
										<pre className="whitespace-pre-wrap break-words font-mono">
											{chunk.current}
										</pre>
									</details>
								)}
							</div>
						))}
						{!chunks.some((c) => c.changed) && (
							<p className="p-3 text-sm">{t("conflicts.identical")}</p>
						)}
					</section>
				) : (
					<p className="text-sm">{t("conflicts.loading")}</p>
				)
			) : (
				<p className="text-muted-foreground text-sm">{t("conflicts.binary")}</p>
			)}
			<p className="text-muted-foreground text-xs">{t("conflicts.hint")}</p>
			<div className="flex flex-wrap justify-end gap-2">
				<Button
					disabled={busy}
					variant="outline"
					onClick={() => void resolve("current")}
				>
					{t("conflicts.keepCurrent")}
				</Button>
				<Button
					disabled={busy}
					variant="outline"
					onClick={() => void resolve("recovered")}
				>
					{t("conflicts.keepRecovered")}
				</Button>
				{texts &&
					conflictVersionExists(conflict.current) &&
					conflictVersionExists(conflict.recovered) && (
						<Button disabled={busy} onClick={() => void resolve("merged")}>
							{t("conflicts.apply")}
						</Button>
					)}
			</div>
		</div>
	);
}

export function ConflictsSection() {
	const { t } = useTranslation("cloud");
	const [items, setItems] = useState<FileConflict[]>([]);
	const [open, setOpen] = useState(false);
	const [batchBusy, setBatchBusy] = useState(false);
	const batchRunning = useRef(false);
	const [batchResult, setBatchResult] = useState<ConflictBatchResult | null>(
		null,
	);
	const refreshId = useRef(0);
	// Keep the compared snapshot stable until the user explicitly opens a new review.
	const [selected, setSelected] = useState<FileConflict | null>(null);
	const refresh = useCallback(async () => {
		const id = ++refreshId.current;
		try {
			const conflicts = await listFileConflicts();
			if (id === refreshId.current) setItems(conflicts);
		} catch (error) {
			notifyError(cloudAiError(error));
		}
	}, []);
	useEffect(() => {
		void refresh();
		return subscribeCloudFiles(() => void refresh());
	}, [refresh]);
	const resolveIdentical = async () => {
		if (batchRunning.current) return;
		batchRunning.current = true;
		setBatchBusy(true);
		setBatchResult(null);
		try {
			const result = await resolveIdenticalFileConflicts(items);
			setBatchResult(result);
			if (result.failed.length)
				notifyError(
					t("conflicts.batchFailed", { count: result.failed.length }),
					{
						description: cloudAiError(result.failed[0].error),
					},
				);
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			await refresh();
			batchRunning.current = false;
			setBatchBusy(false);
		}
	};
	return (
		<>
			<SettingsGroup>
				<SettingsRow
					label={t("conflicts.title")}
					description={
						items.length
							? t("conflicts.pending", { count: items.length })
							: t("conflicts.none")
					}
				>
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							setOpen(true);
							setSelected(null);
							if (!batchRunning.current) setBatchResult(null);
							void refresh();
						}}
					>
						<GitCompareArrows className="size-3.5" />
						{t("conflicts.review")}
					</Button>
				</SettingsRow>
			</SettingsGroup>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>{t("conflicts.title")}</DialogTitle>
						<DialogDescription>{t("conflicts.description")}</DialogDescription>
					</DialogHeader>
					{!selected && (
						<div className="space-y-2" aria-busy={batchBusy}>
							<Button
								size="sm"
								variant="outline"
								disabled={batchBusy || !items.length}
								onClick={() => void resolveIdentical()}
							>
								{batchBusy ? (
									<Loader2 className="size-3.5 motion-safe:animate-spin" />
								) : (
									<CheckCheck className="size-3.5" />
								)}
								{t("conflicts.resolveIdentical")}
							</Button>
							<p className="text-muted-foreground text-xs">
								{t("conflicts.identicalHint")}
							</p>
							<p role="status" className="text-sm">
								{batchResult &&
									t("conflicts.batchResult", {
										resolved: batchResult.resolved,
										remaining: batchResult.skipped + batchResult.failed.length,
									})}
							</p>
						</div>
					)}
					<div className="min-h-0 space-y-3 overflow-y-auto">
						{selected ? (
							<>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setSelected(null)}
								>
									{t("conflicts.back")}
								</Button>
								<ConflictReview
									key={selected.id}
									conflict={selected}
									onResolved={() => {
										setSelected(null);
										void refresh();
									}}
								/>
							</>
						) : items.length ? (
							<ul className="space-y-1">
								{items.map((item) => (
									<li key={item.id}>
										<Button
											variant="ghost"
											disabled={batchBusy}
											className="h-auto w-full justify-start whitespace-normal break-all text-left"
											onClick={() => setSelected(item)}
										>
											{item.path}
										</Button>
									</li>
								))}
							</ul>
						) : (
							<p className="py-8 text-center text-muted-foreground text-sm">
								{t("conflicts.none")}
							</p>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
