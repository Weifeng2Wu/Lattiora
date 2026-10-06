import { RefreshCw, Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import lattioraIcon from "@/assets/lattiora-icon.svg";
import {
	PageTitle,
	SettingsGroup,
} from "@/components/settings/settings-layout";
import { Button } from "@/components/ui/button";
import { cloudAiError } from "@/lib/cloud/ai";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import { openExternalUrl } from "@/lib/core/open-external";
import { version } from "../../../../package.json";

export function AboutPane() {
	const { t } = useTranslation(["settings", "cloud", "common"]);
	const [busy, setBusy] = useState(false);
	async function check() {
		setBusy(true);
		try {
			const registration = await navigator.serviceWorker?.getRegistration();
			if (!registration) throw new Error("offline");
			await registration.update();
			notifySuccess(t("cloud:settings.updateChecked"));
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<PageTitle
				title={t("about.title")}
				actions={
					<Button
						size="sm"
						variant="outline"
						onClick={() =>
							openExternalUrl("https://github.com/Weifeng2Wu/Lattiora")
						}
					>
						<Star className="size-3.5" />
						{t("about.starGithub")}
					</Button>
				}
			/>
			<SettingsGroup>
				<div className="flex items-center justify-between gap-4 px-3.5 py-4">
					<div className="flex min-w-0 items-center gap-3">
						<img
							src={lattioraIcon}
							alt=""
							aria-hidden
							className="size-10 rounded-lg"
						/>
						<div>
							<p className="font-semibold text-base">
								{t("common:brand.fullName")}
							</p>
							<p className="text-muted-foreground text-xs">
								{t("about.version", { version })}
							</p>
						</div>
					</div>
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => void check()}
					>
						<RefreshCw className="size-3.5" />
						{t("about.update.check")}
					</Button>
				</div>
			</SettingsGroup>
			<a
				href="https://github.com/poco-ai/Agentero"
				target="_blank"
				rel="noreferrer"
				className="text-xs text-muted-foreground underline underline-offset-4"
			>
				{t("about.attribution")}
			</a>
		</>
	);
}
