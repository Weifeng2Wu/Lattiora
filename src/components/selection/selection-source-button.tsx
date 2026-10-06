import { LocateFixed } from "lucide-react";
import { useTranslation } from "react-i18next";
import { navigateToSelection } from "@/lib/agent/selection-navigation";
import type { SelectionContext } from "@/lib/agent/selection-store";
export function SelectionSourceButton({
	selection,
}: {
	selection: SelectionContext;
}) {
	const { t } = useTranslation("viewer");
	return (
		<button
			type="button"
			className="mb-2 flex max-w-full items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			title={t("selection.locateSource")}
			onClick={() => void navigateToSelection(selection)}
		>
			<LocateFixed className="size-3.5 shrink-0" />
			<span className="truncate">
				{selection.origin === "chat"
					? t("selection.chatSource")
					: selection.sourcePath}
				{selection.page
					? ` · ${t("selection.sourcePage", { page: selection.page })}`
					: ""}
			</span>
		</button>
	);
}
