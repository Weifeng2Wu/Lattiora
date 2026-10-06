import { BookOpen, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MobileReaderMode } from "@/components/mobile/types";
import { cn } from "@/lib/core/utils";

const MODES: Array<{ id: MobileReaderMode; icon: typeof BookOpen }> = [
	{ id: "pdf", icon: BookOpen },
	{ id: "notes", icon: FileText },
];

export function MobileReaderModeToggle({
	mode,
	onChange,
}: {
	mode: MobileReaderMode;
	onChange: (mode: MobileReaderMode) => void;
}) {
	const { t } = useTranslation("mobile");
	return (
		<div className="flex shrink-0 rounded-lg border bg-muted p-0.5">
			{MODES.map(({ id, icon: Icon }) => (
				<button
					key={id}
					type="button"
					aria-label={t(`reader.${id}`)}
					aria-pressed={mode === id}
					onClick={() => onChange(id)}
					className={cn(
						"grid size-9 place-items-center rounded-md",
						mode === id && "bg-background shadow-sm",
					)}
				>
					<Icon className="size-4" />
				</button>
			))}
		</div>
	);
}
