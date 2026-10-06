import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	aiRequest,
	cloudAiError,
	deleteAiConfig,
	getAiConfig,
	saveAiConfig,
} from "@/lib/cloud/ai";
import { notifyError, notifySuccess } from "@/lib/core/notify";

export function CloudAiConfigBlock() {
	const { t } = useTranslation("cloud");
	const [busy, setBusy] = useState(false);
	const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
	const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
	const [model, setModel] = useState("");
	const [key, setKey] = useState("");
	const [hasKey, setHasKey] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setBusy(true);
		getAiConfig()
			.then((config) => {
				if (cancelled || !config) return;
				setProvider(config.provider);
				setBaseUrl(config.baseUrl);
				setModel(config.model);
				setHasKey(config.hasKey);
			})
			.catch((error) => {
				if (!cancelled) notifyError(cloudAiError(error));
			})
			.finally(() => {
				if (!cancelled) setBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);
	async function save(event: React.FormEvent) {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		try {
			await saveAiConfig({
				provider,
				baseUrl: baseUrl.trim(),
				model: model.trim(),
				...(key.trim() ? { apiKey: key.trim() } : {}),
			});
			setHasKey(true);
			setKey("");
			window.dispatchEvent(new Event("cloud:ai-config"));
			notifySuccess(t("settings.saved"));
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	}
	async function probe() {
		setBusy(true);
		try {
			await aiRequest("probe", {
				provider,
				baseUrl: baseUrl.trim(),
				model: model.trim(),
				...(key.trim() ? { apiKey: key.trim() } : {}),
			});
			notifySuccess(t("settings.probeOk"));
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={save} className="grid gap-4">
			<div className="grid gap-1.5">
				<Label htmlFor="cloud-provider">{t("settings.provider")}</Label>
				<select
					id="cloud-provider"
					className="h-9 rounded-md border bg-background px-3"
					value={provider}
					onChange={(e) => {
						const next = e.target.value as "openai" | "anthropic";
						setProvider(next);
						setBaseUrl(
							next === "anthropic"
								? "https://api.anthropic.com/v1"
								: "https://api.openai.com/v1",
						);
					}}
				>
					<option value="openai">{t("settings.openai")}</option>
					<option value="anthropic">Anthropic</option>
				</select>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="cloud-base-url">{t("settings.baseUrl")}</Label>
				<Input
					id="cloud-base-url"
					type="url"
					required
					value={baseUrl}
					onChange={(e) => setBaseUrl(e.target.value)}
					spellCheck={false}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="cloud-model">{t("settings.model")}</Label>
				<Input
					id="cloud-model"
					required
					value={model}
					onChange={(e) => setModel(e.target.value)}
					spellCheck={false}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="cloud-api-key">{t("settings.apiKey")}</Label>
				<Input
					id="cloud-api-key"
					type="password"
					autoComplete="new-password"
					required={!hasKey}
					value={key}
					onChange={(e) => setKey(e.target.value)}
					placeholder={hasKey ? t("settings.keepKey") : ""}
				/>
			</div>
			<p className="text-xs text-muted-foreground">{t("settings.privacy")}</p>
			<div>
				{hasKey && (
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							try {
								await deleteAiConfig();
								setHasKey(false);
								setKey("");
								window.dispatchEvent(new Event("cloud:ai-config"));
								notifySuccess(t("settings.removed"));
							} catch (error) {
								notifyError(cloudAiError(error));
							} finally {
								setBusy(false);
							}
						}}
					>
						{t("settings.removeKey")}
					</Button>
				)}
				<Button
					type="button"
					variant="outline"
					disabled={busy || !model.trim() || (!hasKey && !key.trim())}
					onClick={() => void probe()}
				>
					{t("settings.testConnection")}
				</Button>
				<Button type="submit" disabled={busy}>
					{busy ? t("settings.saving") : t("settings.save")}
				</Button>
			</div>
		</form>
	);
}
