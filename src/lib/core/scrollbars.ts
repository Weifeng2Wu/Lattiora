const SCROLLING_CLASS = "scrolling";
const HIDE_DELAY_MS = 800;
const TIMEOUT_KEY = Symbol("agentero-scrollbar-timeout");

function handleScroll(event: Event) {
	const target = event.target;
	if (!(target instanceof Element)) return;

	const classes = target.classList;
	if (
		!classes.contains("agentero-scroll") &&
		!classes.contains("agentero-scroll-both")
	) {
		return;
	}

	classes.add(SCROLLING_CLASS);
	const previous = (target as HTMLElement & { [TIMEOUT_KEY]?: number })[
		TIMEOUT_KEY
	];
	if (previous) {
		window.clearTimeout(previous);
	}

	(target as HTMLElement & { [TIMEOUT_KEY]?: number })[TIMEOUT_KEY] =
		window.setTimeout(() => {
			classes.remove(SCROLLING_CLASS);
		}, HIDE_DELAY_MS);
}

export function initAutoHideScrollbars() {
	if (typeof document === "undefined") return;

	document.addEventListener("scroll", handleScroll, {
		capture: true,
		passive: true,
	});
}
