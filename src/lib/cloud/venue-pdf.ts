/** b6320ce5 paper/import/sources: deterministic publisher PDF fallbacks.
 * Only fills absent metadata. A canonical URL does not imply public access.
 */
export function venuePdfUrl(source: string): string | undefined {
	let url: URL;
	try {
		url = new URL(source.trim());
	} catch {
		return;
	}
	if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
	const host = url.hostname.replace(/^www\./, "");
	const known = [
		"aclanthology.org",
		"usenix.org",
		"proceedings.neurips.cc",
		"papers.nips.cc",
		"openaccess.thecvf.com",
		"ecva.net",
		"ijcai.org",
		"proceedings.mlr.press",
		"openreview.net",
		"link.springer.com",
	];
	if (!known.includes(host)) return;
	const path = url.pathname.replace(/\/$/, "");
	if (/\.pdf$/i.test(path)) return url.href;
	const at = (path: string) => new URL(path, url.origin).href;
	let match: RegExpMatchArray | null;
	switch (host) {
		case "aclanthology.org":
			if (/^\/\d{4}\.[^/.]+-[^/.]+\.\d+$/.test(path)) return at(`${path}.pdf`);
			break;
		case "usenix.org":
			match = path.match(/^\/conference\/([^/]+)\/presentation\/([^/]+)$/);
			if (match)
				return `https://www.usenix.org/system/files/${match[1]}-${match[2]}.pdf`;
			break;
		case "proceedings.neurips.cc":
		case "papers.nips.cc":
			if (/\/hash\/[^/]+-Abstract[^/]*\.html$/.test(path))
				return at(
					path
						.replace("/hash/", "/file/")
						.replace("-Abstract", "-Paper")
						.replace(/\.html$/, ".pdf"),
				);
			break;
		case "openaccess.thecvf.com":
			if (/^\/content\/.*\/html\/[^/]+_paper\.html$/.test(path))
				return at(
					path.replace("/html/", "/papers/").replace(/\.html$/, ".pdf"),
				);
			break;
		case "ecva.net":
			match = path.match(/^(.*)\/html\/(\d+)_ECCV_\d{4}_paper\.php$/);
			if (match && Number(match[2]) > 0)
				return at(
					`${match[1]}/papers/${String(Number(match[2])).padStart(5, "0")}.pdf`,
				);
			break;
		case "ijcai.org":
			match = path.match(/^\/proceedings\/(\d{4})\/(\d+)$/);
			if (match)
				return `https://www.ijcai.org/proceedings/${match[1]}/${String(Number(match[2])).padStart(4, "0")}.pdf`;
			break;
		case "proceedings.mlr.press":
			match = path.match(/^\/v(\d+)\/([a-zA-Z\d-]+)\.html$/);
			if (match) {
				const [, volume, key] = match;
				return Number(volume) >= 228
					? `https://raw.githubusercontent.com/mlresearch/v${volume}/main/assets/${key}/${key}.pdf`
					: `https://proceedings.mlr.press/v${volume}/${key}/${key}.pdf`;
			}
			break;
		case "openreview.net":
			if (["/forum", "/pdf"].includes(path) && url.searchParams.get("id")) {
				url.pathname = "/pdf";
				url.hash = "";
				return url.href;
			}
			break;
		case "link.springer.com":
			match = path.match(/^\/(?:chapter|article)\/(10\.[^\s]+)$/);
			if (match) return `https://link.springer.com/content/pdf/${match[1]}.pdf`;
	}
}
