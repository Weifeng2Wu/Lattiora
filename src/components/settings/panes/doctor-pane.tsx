import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageTitle } from "@/components/settings/settings-layout";
import type { SettingsHostContext } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { cloudAiError } from "@/lib/cloud/ai";
import { openCloudDb } from "@/lib/cloud/db";
import { notifyError } from "@/lib/core/notify";
import {
	type DoctorReport,
	doctorCheck,
	doctorCheckNetwork,
} from "@/lib/doctor/api";
import { DoctorAliasSection } from "./doctor-alias-section";
import { DoctorNetworkSection } from "./doctor-network-section";
import { DoctorSection, IssueRows } from "./doctor-sections";
import {
	DoctorCatalogSection,
	DoctorVaultSection,
} from "./doctor-vault-catalog-sections";
import { DoctorVisualMarksSection } from "./doctor-visual-marks-section";
import { DoctorWikilinkSection } from "./doctor-wikilink-section";

type NetworkReport = Awaited<ReturnType<typeof doctorCheckNetwork>>;
export function DoctorPane({
	vaultPath,
}: {
	vaultPath?: string | null;
	hostContext: SettingsHostContext;
}) {
	const { t } = useTranslation(["settings", "cloud"]);
	const [report, setReport] = useState<DoctorReport | null>(null);
	const [network, setNetwork] = useState<NetworkReport | null>(null);
	const [localOk, setLocalOk] = useState<boolean | null>(null);
	const [networkError, setNetworkError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [networkLoading, setNetworkLoading] = useState(true);
	const [wikiPlanning, setWikiPlanning] = useState(false);
	const refresh = useCallback(async () => {
		setLoading(true);
		setReport(null);
		try {
			await openCloudDb();
			setLocalOk(
				Boolean(
					navigator.locks && navigator.serviceWorker && window.isSecureContext,
				),
			);
			if (vaultPath) setReport(await doctorCheck(vaultPath));
		} catch (error) {
			setLocalOk(false);
			notifyError(cloudAiError(error));
		} finally {
			setLoading(false);
		}
	}, [vaultPath]);
	const refreshNetwork = useCallback(async () => {
		setNetworkLoading(true);
		setNetworkError(null);
		setNetwork(null);
		try {
			setNetwork(await doctorCheckNetwork());
		} catch (error) {
			const text = cloudAiError(error);
			setNetworkError(text);
			notifyError(text);
		} finally {
			setNetworkLoading(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
		void refreshNetwork();
	}, [refresh, refreshNetwork]);
	const runtimeIssues = [
		...(localOk === false ? ["browserStorage"] : []),
		...(network && !network.database ? ["database"] : []),
		...(network && !network.objectStorage ? ["objectStorage"] : []),
		...(networkError ? ["serverUnavailable"] : []),
	].map((code) => ({
		code,
		message: t(`cloud:doctor.${code}`, { defaultValue: code }),
		severity: "error" as const,
	}));
	return (
		<>
			<PageTitle
				title={t("doctor.title")}
				actions={
					<Button
						type="button"
						size="icon-sm"
						variant="ghost"
						aria-label={t("doctor.refresh")}
						disabled={loading || networkLoading || wikiPlanning}
						onClick={() => {
							void refresh();
							void refreshNetwork();
						}}
					>
						<RefreshCw className={loading ? "animate-spin" : undefined} />
					</Button>
				}
			/>
			<DoctorSection
				title={t("cloud:doctor.runtime")}
				description={t("cloud:doctor.runtimeHint")}
				ok={loading || networkLoading ? null : runtimeIssues.length === 0}
				issueCount={runtimeIssues.length}
			>
				{runtimeIssues.length ? <IssueRows issues={runtimeIssues} /> : null}
			</DoctorSection>
			<DoctorNetworkSection
				report={network}
				loading={networkLoading}
				error={networkError}
			/>
			{loading ? (
				<Loader2
					className="mx-auto animate-spin"
					aria-label={t("doctor.network.probing")}
				/>
			) : report && vaultPath ? (
				<>
					<DoctorVaultSection
						ok={report.vault.ok}
						issues={report.vault.issues}
					/>
					<DoctorCatalogSection
						ok={report.catalog.ok}
						issues={report.catalog.issues}
					/>
					<DoctorWikilinkSection
						vaultPath={vaultPath}
						wikilinks={report.wikilinks}
						planning={wikiPlanning}
						onPlanningChange={setWikiPlanning}
						onRefresh={refresh}
					/>
					<DoctorAliasSection
						vaultPath={vaultPath}
						aliases={report.aliases}
						onRefresh={refresh}
					/>
					<DoctorVisualMarksSection
						vaultPath={vaultPath}
						visualMarks={report.visualMarks}
						onRefresh={refresh}
					/>
				</>
			) : null}
		</>
	);
}
