/** Provider probe outcome shared by settings panes and onboarding steps. */
export type ProbeStatus = "idle" | "probing" | "ok" | "fail";

/** Tailwind classes for the small provider status dot. `configured=false`
 *  is the dimmer "not configured yet" tone. */
export function probeDotClass(status: ProbeStatus, configured = false): string {
	switch (status) {
		case "ok":
			return "bg-emerald-500";
		case "fail":
			return "bg-destructive";
		case "probing":
			return "bg-amber-500 animate-pulse";
		default:
			return configured ? "bg-muted-foreground/50" : "bg-muted-foreground/35";
	}
}
