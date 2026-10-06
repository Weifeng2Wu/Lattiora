import { Download, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cloudAiError } from "@/lib/cloud/ai";
import { notifyError } from "@/lib/core/notify";
import { getPdfAiRuntime } from "@/lib/pdf/layout/ai-runtime";
import {
	cacheLayoutModel,
	ensureLayoutModel,
	getLayoutModelStatus,
	LAYOUT_MODEL_BYTES,
} from "@/lib/pdf/layout/model";
import { ProviderCard, ProviderCardHeader } from "./provider-card";

export function LayoutModelCard() {
	const { t } = useTranslation("cloud");
	const [ready, setReady] = useState(false);
	const [busy, setBusy] = useState(false);
	const [tested, setTested] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		void getLayoutModelStatus()
			.then((status) => setReady(status.ready))
			.catch(() => {});
	}, []);
	const run = async (file?: File) => {
		setBusy(true);
		setTested(false);
		try {
			if (file) {
				if (file.size !== LAYOUT_MODEL_BYTES)
					throw new Error("layoutModelInvalid");
				await cacheLayoutModel(await file.arrayBuffer());
			} else await ensureLayoutModel();
			setReady(true);
			const { LayoutDetectionPipeline } = await import("@embedpdf/ai");
			const canvas = new OffscreenCanvas(800, 800);
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("layoutModelUnavailable");
			ctx.fillStyle = "white";
			ctx.fillRect(0, 0, 800, 800);
			await getPdfAiRuntime()
				.run(new LayoutDetectionPipeline(), {
					imageData: ctx.getImageData(0, 0, 800, 800),
					sourceWidth: 800,
					sourceHeight: 800,
				})
				.toPromise();
			setTested(true);
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<ProviderCard>
			<ProviderCardHeader left={<span>PP-DocLayoutV3</span>} />
			<p className="px-3 text-xs text-muted-foreground">
				{t("layoutModelInfo")}
			</p>
			<div className="flex items-center gap-2 p-3">
				<span role="status" className="mr-auto text-xs">
					{tested
						? t("layoutModelTested")
						: ready
							? t("layoutModelCached")
							: t("layoutModelMissing")}
				</span>
				<input
					ref={input}
					type="file"
					accept=".onnx"
					className="hidden"
					onChange={(event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = "";
						if (file) void run(file);
					}}
				/>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					aria-label={t("layoutModelUpload")}
					onClick={() => input.current?.click()}
				>
					<Upload className="size-4" />
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => void run()}
				>
					{busy ? (
						<Loader2 className="size-4 animate-spin" />
					) : !ready ? (
						<Download className="size-4" />
					) : null}
					{ready ? t("layoutModelTest") : t("layoutModelDownload")}
				</Button>
			</div>
		</ProviderCard>
	);
}
