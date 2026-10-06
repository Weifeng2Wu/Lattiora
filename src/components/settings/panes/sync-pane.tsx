import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import { StatusDot } from "@/components/settings/status-dot";
import { Button } from "@/components/ui/button";
import { cloudAiError } from "@/lib/cloud/ai";
import { downloadBlob, exportBackup } from "@/lib/cloud/backup";
import { useOfflineReady } from "@/lib/cloud/offline";
import { syncOnce, syncStore } from "@/lib/cloud/sync";
import { notifyError } from "@/lib/core/notify";
import { ConflictsSection } from "./conflicts-section";

export function SyncPane({
	vaultPath: _vaultPath,
}: {
	vaultPath?: string | null;
}) {
	const { t } = useTranslation(["settings", "cloud"]);
	const state = useStore(syncStore);
	const offline = useOfflineReady();
	const [busy, setBusy] = useState(false);
	async function run(operation: () => Promise<void>) {
		setBusy(true);
		try {
			await operation();
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<PageTitle
				title={t("nav.sync")}
				actions={
					<Button
						size="sm"
						variant="outline"
						disabled={busy || state.phase === "syncing"}
						onClick={() => void run(syncOnce)}
					>
						<RefreshCw className="size-3.5" />
						{t("cloud:storage.sync")}
					</Button>
				}
			/>
			<SettingsGroup>
				<SettingsRow label="Cloudflare D1 + R2">
					<StatusDot
						label={t(`cloud:storage.${state.phase}`, { count: state.pending })}
						tone={
							state.phase === "error"
								? "err"
								: state.phase === "offline"
									? "warn"
									: "ok"
						}
					/>
					<span className="text-xs">
						{t(`cloud:storage.${state.phase}`, { count: state.pending })}
					</span>
				</SettingsRow>
				<SettingsRow
					label={t("cloud:settings.syncBackend")}
					description={t("cloud:settings.syncBackendHint")}
				>
					<span className="text-xs">{location.host}</span>
				</SettingsRow>
				<SettingsRow label={t("cloud:storage.offlineReady")}>
					<span className="text-xs">
						{t(
							offline
								? "cloud:storage.offlineReady"
								: "cloud:storage.offlinePreparing",
						)}
					</span>
				</SettingsRow>
				<SettingsRow label={t("cloud:settings.lastSync")}>
					<span className="text-xs tabular-nums">
						{state.lastSync ? new Date(state.lastSync).toLocaleString() : "—"}
					</span>
				</SettingsRow>
			</SettingsGroup>
			<ConflictsSection />
			<SettingsGroup>
				<SettingsRow
					label={t("cloud:storage.backup")}
					description={t("cloud:settings.backupSecrets")}
				>
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() =>
							void run(async () =>
								downloadBlob(
									await exportBackup(),
									`Lattiora-${new Date().toISOString().slice(0, 10)}.zip`,
								),
							)
						}
					>
						<Download className="size-3.5" />
						{t("cloud:storage.backup")}
					</Button>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}
