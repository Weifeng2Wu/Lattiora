import { useTranslation } from "react-i18next";
import { AgentCommonRows } from "@/components/settings/agent-common-rows";
import { AgentModelPicker } from "@/components/settings/agent-model-picker";
import {
	PageTitle,
	SettingsGroup,
	SettingsSectionLabel,
} from "@/components/settings/settings-layout";
import type { AppSettings } from "@/lib/settings";
import { AgentEmbeddingBlock } from "./agent/agent-embedding-block";
import { AgentPersonalPromptBlock } from "./agent/agent-personal-prompt-block";
import { CloudAiConfigBlock } from "./agent/cloud-ai-config-block";

export function AgentPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation("settings");
	return (
		<>
			<PageTitle title={t("agent.title")} />
			<SettingsGroup>
				<div className="px-3.5 py-3">
					<CloudAiConfigBlock />
				</div>
			</SettingsGroup>
			<SettingsGroup>
				<AgentCommonRows settings={settings} patch={patch} />
			</SettingsGroup>
			<AgentPersonalPromptBlock settings={settings} patch={patch} />
			<SettingsSectionLabel className="mt-4">
				{t("agent.pdfAsk.section")}
			</SettingsSectionLabel>
			<SettingsGroup>
				<AgentModelPicker
					value={settings.pdfAsk}
					onChange={(pdfAsk) => patch({ pdfAsk })}
					agentLabel={t("agent.pdfAsk.agentId.label")}
					modelLabel={t("agent.pdfAsk.modelId.label")}
					followDefaultLabel={t("agent.pdfAsk.agentId.followDefault")}
					followDefaultNamedLabel={(name) =>
						t("agent.pdfAsk.agentId.followDefaultNamed", { name })
					}
					followModelLabel={t("agent.pdfAsk.modelId.followAgent")}
				/>
			</SettingsGroup>
			<AgentEmbeddingBlock settings={settings} patch={patch} />
		</>
	);
}
