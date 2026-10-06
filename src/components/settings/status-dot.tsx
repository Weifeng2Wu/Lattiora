import { cn } from "@/lib/core/utils";

export type StatusDotTone = "ok" | "idle" | "warn" | "err";

export function StatusDot({
	tone,
	label,
}: {
	tone: StatusDotTone;
	label: string;
}) {
	return (
		<span className="inline-flex items-center gap-2 text-muted-foreground text-xs leading-none">
			<span
				role="img"
				aria-label={label}
				className={cn(
					"size-2 shrink-0 rounded-full ring-2 ring-background",
					tone === "ok" && "bg-emerald-500",
					tone === "idle" && "bg-muted-foreground/45",
					tone === "warn" && "bg-amber-500",
					tone === "err" && "bg-destructive",
				)}
			/>
			<span className="font-medium text-foreground/80">{label}</span>
		</span>
	);
}
