import {
	Archive,
	Download,
	Files,
	FileUp,
	House,
	Link2,
	LogOut,
	Network,
	RefreshCw,
	Search,
	Settings2,
	Upload,
	WifiOff,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cloudAiError } from "@/lib/cloud/ai";
import { downloadBlob, exportBackup, restoreBackup } from "@/lib/cloud/backup";
import {
	downloadBibliography,
	pickAndImportBibliography,
	pickAndImportFiles,
	pickAndImportPdfs,
	pickFiles,
} from "@/lib/cloud/import";
import { useOfflineReady } from "@/lib/cloud/offline";
import { cloudFetch, syncOnce, syncStore } from "@/lib/cloud/sync";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import { openSettingsWindow } from "@/lib/shell/settings-window";
import { CloudAiSettingsDialog } from "./cloud-ai-settings-dialog";
import { SharePanel } from "./share-panel";

export function CloudToolbar({
	onHome,
	onGraph,
	onSearch,
}: {
	onHome?: () => void;
	onGraph?: () => void;
	onSearch?: () => void;
}) {
	const { t } = useTranslation(["cloud", "app", "editor"]);
	const state = useStore(syncStore);
	const offlineReady = useOfflineReady();
	const [busy, setBusy] = useState(false);
	const [sharesOpen, setSharesOpen] = useState(false);
	const [shareBusy, setShareBusy] = useState(false);
	async function run(operation: () => Promise<unknown>, success = false) {
		if (busy) return;
		setBusy(true);
		try {
			await operation();
			if (success) notifySuccess(t("storage.completed"));
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	}
	async function logout() {
		try {
			if (navigator.onLine)
				await cloudFetch("/api/session", { method: "DELETE" });
		} finally {
			localStorage.setItem("agentero-cloud-locked", "1");
			window.dispatchEvent(new Event("cloud:lock"));
		}
	}

	return (
		<>
			<div
				className="flex h-9 shrink-0 items-center gap-1 border-b bg-sidebar px-3"
				role="toolbar"
				aria-label={t("storage.title")}
			>
				{onHome && (
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={t("app:home.title")}
						title={t("app:home.title")}
						onClick={onHome}
					>
						<House />
					</Button>
				)}
				{onGraph && (
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={t("app:research.graph.title")}
						title={t("app:research.graph.title")}
						onClick={onGraph}
					>
						<Network />
					</Button>
				)}
				{onSearch && (
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={t("app:research.semantic-search.title")}
						title={t("app:research.semantic-search.title")}
						onClick={onSearch}
					>
						<Search />
					</Button>
				)}
				<span
					className="mr-auto truncate text-xs text-muted-foreground"
					role="status"
				>
					{t(`storage.${state.phase}`, { count: state.pending })} ·{" "}
					{t(
						offlineReady ? "storage.offlineReady" : "storage.offlinePreparing",
					)}
				</span>
				{state.error === "signInRequired" && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							localStorage.setItem("agentero-cloud-locked", "1");
							window.dispatchEvent(new Event("cloud:lock"));
						}}
					>
						{t("login.signIn")}
					</Button>
				)}
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={t("storage.sync")}
					title={t("storage.sync")}
					disabled={busy || state.phase === "syncing"}
					onClick={() => void run(syncOnce)}
				>
					{state.phase === "offline" ? (
						<WifiOff />
					) : (
						<RefreshCw
							className={
								state.phase === "syncing"
									? "animate-spin motion-reduce:animate-none"
									: ""
							}
						/>
					)}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon-xs"
							disabled={busy}
							aria-label={t("storage.import")}
							title={t("storage.import")}
						>
							<Upload />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem
							onSelect={() => void run(() => pickAndImportPdfs(), true)}
						>
							<FileUp />
							{t("storage.pdf")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => void run(() => pickAndImportBibliography(), true)}
						>
							<Archive />
							{t("storage.bibliography")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => void run(pickAndImportFiles, true)}
						>
							<Files />
							{t("storage.files")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() =>
								void run(async () => {
									const [file] = await pickFiles(".zip", false);
									if (file) await restoreBackup(file);
								}, true)
							}
						>
							<Archive />
							{t("storage.restore")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							size="icon-xs"
							variant="ghost"
							disabled={busy}
							aria-label={t("storage.export")}
							title={t("storage.export")}
						>
							<Download />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem
							onSelect={() =>
								void run(async () =>
									downloadBlob(
										await exportBackup(),
										`agentero-${new Date().toISOString().slice(0, 10)}.zip`,
									),
								)
							}
						>
							{t("storage.backup")}
						</DropdownMenuItem>
						{["bibtex", "ris", "json"].map((format) => (
							<DropdownMenuItem
								key={format}
								onSelect={() => void run(() => downloadBibliography(format))}
							>
								{t("storage.exportFormat", { format: format.toUpperCase() })}
							</DropdownMenuItem>
						))}
						<DropdownMenuItem onSelect={() => setSharesOpen(true)}>
							<Link2 />
							{t("editor:share.manage")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={t("settings.title")}
					title={t("settings.title")}
					onClick={() => openSettingsWindow("general")}
				>
					<Settings2 />
				</Button>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={t("storage.logout")}
					title={t("storage.logout")}
					onClick={() => void run(logout)}
				>
					<LogOut />
				</Button>
			</div>
			<CloudAiSettingsDialog />
			<Dialog
				open={sharesOpen}
				onOpenChange={(open) => {
					if (!shareBusy) setSharesOpen(open);
				}}
			>
				<DialogContent className="sm:max-w-lg" showCloseButton={!shareBusy}>
					<DialogHeader>
						<DialogTitle>{t("editor:share.manage")}</DialogTitle>
					</DialogHeader>
					{sharesOpen && <SharePanel onBusyChange={setShareBusy} />}
				</DialogContent>
			</Dialog>
		</>
	);
}
