import { Copy, Link2Off, Loader2, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ShareInfo, ShareSettings } from "@/lib/cloud/share-protocol";
import {
	listShares,
	revokeShare,
	shareError,
	shareUrl,
} from "@/lib/cloud/shares";
import { notifyError, notifySuccess } from "@/lib/core/notify";

export function SharePanel({
	sourcePath,
	onCreate,
	onBusyChange,
	linkedNotes,
}: {
	sourcePath?: string;
	onCreate?: (
		settings: ShareSettings,
		selectedPaths: string[],
	) => Promise<ShareInfo>;
	onBusyChange?: (busy: boolean) => void;
	linkedNotes?: { path: string; title: string }[];
}) {
	const { t, i18n } = useTranslation("editor");
	const [shares, setShares] = useState<ShareInfo[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [loading, setLoading] = useState(true);
	const [reload, setReload] = useState(0);
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const [protectedLink, setProtectedLink] = useState(false);
	const [key, setKey] = useState("");
	const [duration, setDuration] = useState("7");
	const [customExpiry, setCustomExpiry] = useState("");
	const [now, setNow] = useState(Date.now());
	const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
	const expiresAt =
		duration === "never"
			? null
			: duration === "custom"
				? new Date(customExpiry).getTime()
				: Date.now() + Number(duration) * 86400000;
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	useEffect(() => {
		const controller = new AbortController();
		void reload; // Explicit refresh retries a failed request without changing its URL.
		setLoading(true);
		setLoaded(false);
		void listShares(sourcePath, controller.signal)
			.then((rows) => {
				if (controller.signal.aborted) return;
				setShares(rows.filter((row) => row.revokedAt === null));
				setLoaded(true);
			})
			.catch((error) => {
				if (!controller.signal.aborted) notifyError(shareError(error));
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [sourcePath, reload]);
	async function run(operation: () => Promise<void>) {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		onBusyChange?.(true);
		try {
			await operation();
		} catch (error) {
			notifyError(shareError(error));
		} finally {
			inFlight.current = false;
			setBusy(false);
			onBusyChange?.(false);
		}
	}
	return (
		<div className="flex min-w-0 flex-col gap-4">
			{onCreate && (
				<>
					<p className="text-muted-foreground text-xs">
						{t("share.snapshotHint")}
					</p>
					{Boolean(linkedNotes?.length) && (
						<fieldset className="space-y-2">
							<legend className="mb-2 text-sm font-medium">
								{t("share.linkedNotes")}
							</legend>
							<p className="text-xs text-muted-foreground">
								{t("share.linkedNotesHint")}
							</p>
							<div className="max-h-40 space-y-2 overflow-auto">
								{linkedNotes?.map((note, index) => (
									<div key={note.path} className="flex items-center gap-2">
										<Checkbox
											id={`share-note-${index}`}
											disabled={busy}
											checked={selectedPaths.includes(note.path)}
											onCheckedChange={(checked) =>
												setSelectedPaths((paths) =>
													checked === true
														? [...paths, note.path]
														: paths.filter((path) => path !== note.path),
												)
											}
										/>
										<Label
											htmlFor={`share-note-${index}`}
											className="min-w-0 truncate"
											title={note.path}
										>
											{note.title}
										</Label>
									</div>
								))}
							</div>
						</fieldset>
					)}
					<div className="flex items-center gap-2">
						<Checkbox
							id="share-protected"
							checked={protectedLink}
							disabled={busy}
							onCheckedChange={(value) => {
								setProtectedLink(value === true);
								if (value === true && !key)
									setKey(crypto.randomUUID().replaceAll("-", "").slice(0, 12));
							}}
						/>
						<Label htmlFor="share-protected">{t("share.requireKey")}</Label>
					</div>
					{protectedLink && (
						<div className="space-y-2">
							<Label htmlFor="share-key">{t("share.key")}</Label>
							<Input
								id="share-key"
								value={key}
								minLength={4}
								maxLength={128}
								autoComplete="off"
								spellCheck={false}
								disabled={busy}
								onChange={(event) => setKey(event.target.value)}
							/>
						</div>
					)}
					<div className="flex items-center gap-3">
						<Label htmlFor="share-expiry" className="shrink-0">
							{t("share.expiry")}
						</Label>
						<select
							id="share-expiry"
							className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
							disabled={busy}
							value={duration}
							onChange={(event) => setDuration(event.target.value)}
						>
							{["1", "7", "30"].map((days) => (
								<option key={days} value={days}>
									{t("share.days", { count: Number(days) })}
								</option>
							))}
							<option value="never">{t("share.never")}</option>
							<option value="custom">{t("share.custom")}</option>
						</select>
					</div>
					{duration === "custom" && (
						<Input
							type="datetime-local"
							aria-label={t("share.expiry")}
							value={customExpiry}
							disabled={busy}
							onChange={(event) => setCustomExpiry(event.target.value)}
						/>
					)}
					<Button
						type="button"
						disabled={
							busy ||
							!loaded ||
							(protectedLink && key.length < 4) ||
							(expiresAt !== null &&
								(!Number.isFinite(expiresAt) || expiresAt <= now))
						}
						onClick={() =>
							void run(async () => {
								const share = await onCreate(
									{
										key: protectedLink ? key : null,
										expiresAt,
									},
									selectedPaths,
								);
								setShares((rows) => [share, ...rows]);
								notifySuccess(t("share.created"));
							})
						}
					>
						{busy && (
							<Loader2
								className="size-4 animate-spin motion-reduce:animate-none"
								aria-hidden
							/>
						)}
						{t("share.create")}
					</Button>
				</>
			)}
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">{t("share.manage")}</span>
				{!busy && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={loading}
						onClick={() => setReload((value) => value + 1)}
					>
						{t("share.refresh")}
					</Button>
				)}
			</div>
			{loading ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t("share.loading")}
				</p>
			) : loaded && shares.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("share.empty")}</p>
			) : null}
			<ul className="max-h-64 space-y-3 overflow-y-auto overscroll-contain">
				{shares.map((share) => {
					const closed = share.revokedAt !== null;
					const expired = share.expiresAt !== null && share.expiresAt <= now;
					const active = !closed && !expired;
					return (
						<li key={share.id} className="space-y-2 rounded-md border p-3">
							<div className="flex min-w-0 items-center gap-2">
								<span
									className="truncate text-sm font-medium"
									title={share.title}
								>
									{share.title}
								</span>
								{share.hasKey && (
									<LockKeyhole
										className="size-3.5 shrink-0"
										aria-label={t("share.requireKey")}
									/>
								)}
							</div>
							<p className="text-muted-foreground text-xs">
								{closed
									? t("share.closed")
									: expired
										? t("share.expired")
										: share.expiresAt === null
											? t("share.never")
											: t("share.expiresOn", {
													date: new Date(share.expiresAt).toLocaleString(
														i18n.language,
													),
												})}
							</p>
							<div className="flex items-center gap-1">
								<Input
									className="h-8 min-w-0 text-xs"
									readOnly
									value={shareUrl(share.id)}
									aria-label={t("share.link")}
									onFocus={(event) => event.target.select()}
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									disabled={busy || !active}
									aria-label={t("share.copy")}
									title={t("share.copy")}
									onClick={() =>
										void run(async () => {
											await navigator.clipboard.writeText(shareUrl(share.id));
											notifySuccess(t("share.copied"));
										})
									}
								>
									<Copy />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									disabled={busy || closed}
									aria-label={t("share.close")}
									title={t("share.close")}
									onClick={() =>
										void run(async () => {
											await revokeShare(share.id);
											setShares((rows) =>
												rows.filter((row) => row.id !== share.id),
											);
											notifySuccess(t("share.closed"));
										})
									}
								>
									<Link2Off />
								</Button>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
