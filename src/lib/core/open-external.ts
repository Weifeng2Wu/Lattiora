/** Open public URLs with opener isolation. */
export function openExternalUrl(url: string): void {
	if (!/^https?:\/\//i.test(url)) return;
	window.open(url, "_blank", "noopener,noreferrer");
}
