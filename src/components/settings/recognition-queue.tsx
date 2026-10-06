import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cloudAiError } from "@/lib/cloud/ai";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import {
	listRecognitionJobs,
	processRecognitionQueue,
	retryRecognitionJobs,
} from "@/lib/cloud/recognition";
import { notifyError } from "@/lib/core/notify";
export function RecognitionQueue() {
	const { t } = useTranslation("cloud");
	const [counts, setCounts] = useState({ pending: 0, failed: 0, cancelled: 0 });
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let live = true;
		const refresh = () =>
			void listRecognitionJobs()
				.then((rows) => {
					if (live)
						setCounts({
							pending: rows.filter((r) => r.job.state === "pending").length,
							failed: rows.filter((r) => r.job.state === "failed").length,
							cancelled: rows.filter((r) => r.job.state === "cancelled").length,
						});
				})
				.catch((e) => notifyError(cloudAiError(e)));
		refresh();
		const unsubscribe = subscribeCloudFiles((paths) => {
			if (paths.some((p) => p.startsWith(".agentero/recognition/"))) refresh();
		});
		return () => {
			live = false;
			unsubscribe();
		};
	}, []);
	return (
		<div className="flex items-center justify-between gap-2 px-3 pb-3 text-xs text-muted-foreground">
			<span>{t("recognizer.queue", counts)}</span>
			<Button
				variant="outline"
				disabled={busy || (!counts.failed && !counts.cancelled)}
				onClick={() => {
					setBusy(true);
					void retryRecognitionJobs()
						.then(() => processRecognitionQueue())
						.catch((e) => notifyError(cloudAiError(e)))
						.finally(() => setBusy(false));
				}}
			>
				{t("recognizer.retry")}
			</Button>
		</div>
	);
}
