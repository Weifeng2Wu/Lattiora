import { useTranslation } from "react-i18next";
import type { DoctorIssue } from "@/lib/doctor/api";
import { DoctorSection, IssueRows } from "./doctor-sections";

export function DoctorVaultSection({
	ok,
	issues,
}: {
	ok: boolean;
	issues: DoctorIssue[];
}) {
	const { t } = useTranslation("settings");

	return (
		<DoctorSection
			title={t("doctor.sections.vault")}
			description={t("doctor.sectionHints.vault")}
			ok={ok}
			issueCount={issues.length}
		>
			{issues.length > 0 ? <IssueRows issues={issues} /> : null}
		</DoctorSection>
	);
}

export function DoctorCatalogSection({
	ok,
	issues,
}: {
	ok: boolean;
	issues: DoctorIssue[];
}) {
	const { t } = useTranslation("settings");
	return (
		<DoctorSection
			title={t("doctor.sections.catalog")}
			description={t("doctor.sectionHints.catalog")}
			ok={ok}
			issueCount={issues.length}
		>
			{issues.length ? <IssueRows issues={issues} /> : null}
		</DoctorSection>
	);
}
