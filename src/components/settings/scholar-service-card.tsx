import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	SettingsGroup,
	SettingsRow,
	SettingsSectionLabel,
} from "@/components/settings/settings-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cloudAiError } from "@/lib/cloud/ai";
import {
	DEFAULT_RECOGNIZER_BASE_URL,
	DEFAULT_TRANSLATOR_BASE_URL,
	type ScholarServiceConfig,
} from "@/lib/cloud/scholar-defaults";
import { cloudFetch } from "@/lib/cloud/sync";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import {
	type AppSettings,
	loadSettings,
	saveSettingsAsync,
} from "@/lib/settings";
import { RecognitionQueue } from "./recognition-queue";
export function ScholarServiceCard({
	settings,
	service = "scholar",
}: {
	settings: AppSettings;
	service?: "scholar" | "recognizer" | "translator";
}) {
	const { t } = useTranslation("cloud");
	const config: ScholarServiceConfig = settings[service];
	const [draft, setDraft] = useState(config);
	const previous = useRef(config);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const old = previous.current;
		previous.current = config;
		setDraft((d) => ({
			baseUrl: d.baseUrl === old.baseUrl ? config.baseUrl : d.baseUrl,
			apiKey: d.apiKey === old.apiKey ? config.apiKey : d.apiKey,
			enabled: d.enabled === old.enabled ? config.enabled : d.enabled,
		}));
	}, [config]);
	const save = async () => {
		setBusy(true);
		try {
			const saved = await saveSettingsAsync({
				...loadSettings(),
				[service]: draft,
			});
			setDraft(saved[service]);
			notifySuccess(t(`${service}.saved`));
		} catch (e) {
			notifyError(cloudAiError(e));
		} finally {
			setBusy(false);
		}
	};
	const probe = async () => {
		setBusy(true);
		try {
			await cloudFetch(
				service === "scholar"
					? "/api/citing"
					: service === "translator"
						? "/api/translator"
						: "/api/recognize",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...draft, operation: "probe" }),
				},
			);
			notifySuccess(t(`${service}.connected`));
		} catch (e) {
			notifyError(cloudAiError(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<SettingsSectionLabel>{t(`${service}.title`)}</SettingsSectionLabel>
			<SettingsGroup>
				{service !== "scholar" && (
					<SettingsRow
						label={t(`${service}.enabled`)}
						htmlFor={`${service}-enabled`}
					>
						<Switch
							id={`${service}-enabled`}
							checked={draft.enabled !== false}
							disabled={busy}
							onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
						/>
					</SettingsRow>
				)}
				<SettingsRow
					label={t(`${service}.endpoint`)}
					description={t(`${service}.description`)}
				>
					<Input
						aria-label={t(`${service}.endpoint`)}
						placeholder={
							service === "scholar"
								? "https://api.semanticscholar.org/graph/v1"
								: service === "translator"
									? DEFAULT_TRANSLATOR_BASE_URL
									: DEFAULT_RECOGNIZER_BASE_URL
						}
						value={draft.baseUrl}
						disabled={busy}
						onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
					/>
				</SettingsRow>
				<SettingsRow label={t(`${service}.key`)}>
					<Input
						aria-label={t(`${service}.key`)}
						type="password"
						autoComplete="off"
						value={draft.apiKey}
						disabled={busy}
						onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
					/>
				</SettingsRow>
				<div className="flex justify-end gap-2 p-3">
					<Button
						variant="outline"
						disabled={busy || !draft.baseUrl.trim()}
						onClick={() => void probe()}
					>
						{t(`${service}.test`)}
					</Button>
					<Button disabled={busy} onClick={() => void save()}>
						{t(`${service}.save`)}
					</Button>
				</div>
				{service === "recognizer" && <RecognitionQueue />}
			</SettingsGroup>
		</>
	);
}
