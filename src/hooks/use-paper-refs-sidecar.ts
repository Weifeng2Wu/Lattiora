import { useEffect, useState } from "react";
import { cloudAiError } from "@/lib/cloud/ai";
import { cloudRelative, subscribeCloudFiles } from "@/lib/cloud/files";
import { notifyError } from "@/lib/core/notify";
import {
	type CiteSidecar,
	loadPaperRefsReadOnly,
	paperRefsParse,
} from "@/lib/paper/refs";

/**
 * Reference sidecar shared by the original panel and PDF citation previews.
 * Browser file notifications refresh local matches and changed sources.
 */
export function usePaperRefsSidecar(
	vaultPath: string | null,
	paperPath: string | null,
): {
	sidecar: CiteSidecar | null;
	loading: boolean;
	setSidecar: (sidecar: CiteSidecar | null) => void;
} {
	const [sidecar, setSidecar] = useState<CiteSidecar | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		setSidecar(null);
		if (!vaultPath || !paperPath) {
			return;
		}
		let cancelled = false;
		let generation = 0;
		setLoading(true);
		const reload = (parse = false) => {
			const request = ++generation;
			(parse
				? paperRefsParse(vaultPath, paperPath)
				: loadPaperRefsReadOnly(vaultPath, paperPath)
			)
				.then((s) => {
					if (!cancelled && request === generation) setSidecar(s);
				})
				.catch((error) => {
					if (!cancelled && request === generation)
						notifyError(cloudAiError(error));
				})
				.finally(() => {
					if (!cancelled && request === generation) setLoading(false);
				});
		};
		reload();
		const unsubscribe = subscribeCloudFiles((paths) => {
			if (
				paths.some(
					(path) =>
						path === `${cloudRelative(paperPath)}/source/agentero-cite.json` ||
						path.endsWith("/.paper.json") ||
						(path.startsWith(`${cloudRelative(paperPath)}/source/`) &&
							/\.(bib|bbl|tex|ltx)$/i.test(path)),
				)
			)
				reload(
					paths.some(
						(path) =>
							path.startsWith(`${cloudRelative(paperPath)}/source/`) &&
							/\.(bib|bbl|tex|ltx)$/i.test(path),
					),
				);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [vaultPath, paperPath]);

	return { sidecar, loading, setSidecar };
}
