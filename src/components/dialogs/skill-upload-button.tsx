import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cloudAiError } from "@/lib/cloud/ai";
import { discoverUploadedSkills } from "@/lib/cloud/skill-import";
import { notifyError } from "@/lib/core/notify";
import { setSkillImportDraft, uiStore } from "@/lib/shell/ui-store";

export function SkillUploadButton() {
	const { t } = useTranslation("sidebar");
	const input = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	return (
		<>
			<input
				ref={input}
				type="file"
				accept=".md,.zip"
				className="hidden"
				onChange={async (event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = "";
					if (!file) return;
					setBusy(true);
					try {
						const discovery = await discoverUploadedSkills(file);
						setSkillImportDraft([
							...(uiStore.getState().skillImportDraft ?? []),
							discovery,
						]);
					} catch (error) {
						notifyError(cloudAiError(error));
					} finally {
						setBusy(false);
					}
				}}
			/>
			<Button
				variant="ghost"
				size="icon-xs"
				disabled={busy}
				aria-label={t("lookup.skillUpload")}
				title={t("lookup.skillUpload")}
				onClick={() => input.current?.click()}
			>
				{busy ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<FileUp className="size-3.5" />
				)}
			</Button>
		</>
	);
}
