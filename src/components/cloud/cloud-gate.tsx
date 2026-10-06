import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import lattioraIcon from "@/assets/lattiora-icon.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloudAiError } from "@/lib/cloud/ai";
import { openCloudDb } from "@/lib/cloud/db";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import { readCloudSettings } from "@/lib/cloud/settings";
import {
	cloudFetch,
	startSync,
	syncOnce,
	verifyWorkspace,
} from "@/lib/cloud/sync";
import { notifyError } from "@/lib/core/notify";
import { scheduleLibraryRefresh } from "@/lib/paper/library-store";
import { applyExternalSettings } from "@/lib/settings/store";
import { scheduleTreeRefresh } from "@/lib/vault/store";
import { bumpWikiIndexRevision } from "@/lib/wiki/store";
import { applyDiskChange } from "@/lib/workspace/actions";

export function CloudGate({ children }: { children: ReactNode }) {
	const { t } = useTranslation(["cloud", "common"]);
	const [ready, setReady] = useState(
		() =>
			Boolean(localStorage.getItem("agentero-cloud-workspace")) &&
			!localStorage.getItem("agentero-cloud-locked"),
	);
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const lock = () => setReady(false);
		const storage = (event: StorageEvent) => {
			if (event.key === "agentero-cloud-locked" && event.newValue)
				setReady(false);
		};
		window.addEventListener("cloud:lock", lock);
		window.addEventListener("storage", storage);
		return () => {
			window.removeEventListener("cloud:lock", lock);
			window.removeEventListener("storage", storage);
		};
	}, []);
	useEffect(() => {
		if (!ready) return;
		void openCloudDb().catch((error) => notifyError(cloudAiError(error)));
		const stop = startSync();
		const unsubscribe = subscribeCloudFiles((paths, remote) => {
			scheduleTreeRefresh();
			scheduleLibraryRefresh();
			bumpWikiIndexRevision();
			if (remote)
				for (const path of paths) void applyDiskChange(`/cloud/${path}`);
		});
		return () => {
			stop();
			unsubscribe();
		};
	}, [ready]);
	async function login(event: React.FormEvent) {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		try {
			if (!navigator.locks || !indexedDB) throw new Error("browserUnsupported");
			await cloudFetch("/api/session", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ password }),
			});
			await verifyWorkspace();
			await openCloudDb();
			localStorage.removeItem("agentero-cloud-locked");
			// A new device has no settings revision yet. Establish the server
			// baseline before exposing editable defaults, otherwise the initial
			// pull would immediately displace the user's first preference edits.
			await syncOnce();
			const settings = await readCloudSettings();
			if (settings) applyExternalSettings(settings);
			setPassword("");
			setReady(true);
			void navigator.storage?.persist();
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	}
	if (ready) return children;
	return (
		<main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
			<form
				onSubmit={login}
				className="grid w-full max-w-sm gap-4 rounded-xl border p-6 shadow-sm"
			>
				<img
					src={lattioraIcon}
					alt=""
					aria-hidden
					className="size-12 rounded-xl"
				/>
				<h1 className="text-xl font-semibold">{t("common:brand.name")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("login.description")}
				</p>
				<Label htmlFor="cloud-password">{t("login.password")}</Label>
				<Input
					id="cloud-password"
					type="password"
					autoComplete="current-password"
					required
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					autoFocus
				/>
				<Button type="submit" disabled={busy}>
					{t(busy ? "login.signingIn" : "login.signIn")}
				</Button>
				<p className="text-xs text-muted-foreground">
					{t("login.localPrivacy")}
				</p>
			</form>
		</main>
	);
}
