import {
	applyCloudAliases,
	applyCloudWikilinks,
	checkCloudDoctor,
	ignoreCloudAliases,
	planCloudWikilinks,
	repairCloudVisualMarks,
} from "@/lib/cloud/doctor";
import { cloudFetch } from "@/lib/cloud/sync";
import type {
	AliasRepairCandidate_Serialize,
	DoctorIssue_Serialize,
	DoctorReport_Serialize,
	DoctorVaultState,
	NetworkDoctorReport_Serialize,
	NetworkEndpointDiagnostic_Serialize,
	VisualMarkCandidate,
	WikiCheckIssue_Serialize,
	WikilinkRepairPlan_Serialize,
	WikilinkRepairResidual_Serialize,
	WikilinkRepairSuggestion_Serialize,
} from "@/lib/core/bindings";

/** Read models come straight from the generated wire contract. */
export type DoctorIssue = DoctorIssue_Serialize;
export type AliasRepairCandidate = AliasRepairCandidate_Serialize;
export type WikiCheckIssue = WikiCheckIssue_Serialize;
export type { VisualMarkCandidate };
export type DoctorReport = DoctorReport_Serialize;
export type WikilinkRepairSuggestion = WikilinkRepairSuggestion_Serialize;
export type WikilinkRepairResidual = WikilinkRepairResidual_Serialize;
export type WikilinkRepairPlan = WikilinkRepairPlan_Serialize;
export type { DoctorVaultState };
export type NetworkEndpointDiagnostic = NetworkEndpointDiagnostic_Serialize;
export type NetworkDoctorReport = NetworkDoctorReport_Serialize;
export type { NetworkStatus } from "@/lib/core/bindings";

type AliasRepairChange = {
	path: string;
	titleAlias: string;
	shortAlias: string;
	expectedHash: string;
};

type WikilinkRepairChange = {
	source: string;
	rangeStart: number;
	rangeEnd: number;
	expected: string;
	replacement: string;
	expectedHash: string;
};

type VisualMarkRepairChange = {
	path: string;
};

export function doctorCheck(vaultPath: string): Promise<DoctorReport> {
	void vaultPath;
	return checkCloudDoctor();
}

/** Read-only checks of the deployed bindings and fixed public research endpoints. */
export async function doctorCheckNetwork(): Promise<
	NetworkDoctorReport & { database: boolean; objectStorage: boolean }
> {
	return (await cloudFetch("/api/diagnostics")).json();
}

export function doctorApplyAliases(
	vaultPath: string,
	changes: AliasRepairChange[],
): Promise<{ updatedPaths: string[] }> {
	void vaultPath;
	return applyCloudAliases(changes);
}

/** Persist ignore/restore for paper-alias candidates (vault `.agentero/doctor.json`). */
export function doctorIgnoreAliases(
	vaultPath: string,
	paths: string[],
	ignore: boolean,
): Promise<DoctorVaultState> {
	void vaultPath;
	return ignoreCloudAliases(paths, ignore);
}

export function doctorPlanWikilinks(
	vaultPath: string,
): Promise<WikilinkRepairPlan> {
	void vaultPath;
	return planCloudWikilinks();
}

export function doctorApplyWikilinks(
	vaultPath: string,
	changes: WikilinkRepairChange[],
): Promise<{ updatedPaths: string[] }> {
	void vaultPath;
	return applyCloudWikilinks(changes);
}

export function doctorApplyVisualMarks(
	vaultPath: string,
	changes: VisualMarkRepairChange[],
): Promise<{ updatedPaths: string[] }> {
	void vaultPath;
	return repairCloudVisualMarks(changes);
}
