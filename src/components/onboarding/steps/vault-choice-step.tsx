import { FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChoiceCard } from "@/components/onboarding/choice-card";

export function VaultChoiceStep({ onCreate }: { onCreate: () => void }) {
	const { t } = useTranslation(["onboarding", "cloud"]);

	return (
		<div className="flex justify-center">
			<ChoiceCard
				icon={<FolderPlus className="size-5 text-muted-foreground" />}
				title={t("cloud:settings.importFiles")}
				description={t("cloud:settings.importIntoWorkspace")}
				onClick={onCreate}
			/>
		</div>
	);
}
