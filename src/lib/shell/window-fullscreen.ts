/** Use the browser fullscreen API; the browser retains its exit controls. */
export async function toggleBorderlessFullscreen(): Promise<void> {
	if (document.fullscreenElement) await document.exitFullscreen();
	else await document.documentElement.requestFullscreen();
}
