import { getCloudPaper } from "./catalog";
import { cloudLock, localTransaction } from "./db";
import {
	cloudRelative,
	editedFile,
	filesChanged,
	listLocalFiles,
} from "./files";
import { unpackArxivSource } from "./source-archive";
import { cloudFetch } from "./sync";
import { venuePdfUrl } from "./venue-pdf";
export type PaperAssets = {
	pdf: boolean;
	tex: boolean;
	paperMd: boolean;
	errors: string[];
};
/** Downloads missing assets only; user-edited sources are never replaced by an archive. */
export async function downloadCloudAssets(
	path: string,
	signal?: AbortSignal,
): Promise<PaperAssets> {
	const rel = cloudRelative(path);
	return cloudLock(`paper-assets:${rel}`, async () => {
		signal?.throwIfAborted();
		const snapshot = await listLocalFiles();
		const before = new Map(snapshot.map((f) => [f.path, f]));
		const paper = await getCloudPaper(rel);
		const own = snapshot.filter(
			(f) => !f.deleted && f.path.startsWith(`${rel}/`),
		);
		const result: PaperAssets = {
			pdf: own.some(
				(f) => /\.pdf$/i.test(f.path) && !f.path.startsWith(`${rel}/source/`),
			),
			tex: own.some((f) => /\.(tex|ltx)$/i.test(f.path)),
			paperMd: own.some((f) => f.path === `${rel}/PAPER.md`),
			errors: [],
		};
		const persist = async (entries: Array<{ path: string; data: Blob }>) => {
			await cloudLock("files", () =>
				localTransaction((files) => {
					signal?.throwIfAborted();
					const meta = `${rel}/.paper.json`;
					if (files.get(meta)?.localId !== before.get(meta)?.localId)
						throw new Error("assetInputsChanged");
					for (const entry of entries) {
						if (
							files.get(entry.path)?.localId !==
								before.get(entry.path)?.localId ||
							(files.get(entry.path) && !files.get(entry.path)?.deleted)
						)
							throw new Error("assetInputsChanged");
					}
					for (const entry of entries)
						files.set(
							entry.path,
							editedFile(entry.path, entry.data, files.get(entry.path)),
						);
				}),
			);
			filesChanged(entries.map((e) => e.path));
		};
		const pdfUrl =
			paper.pdf_url ||
			(paper.arxiv_id ? `https://arxiv.org/pdf/${paper.arxiv_id}` : null) ||
			venuePdfUrl(paper.html_url || "") ||
			venuePdfUrl(paper.source_url || "");
		if (!result.pdf && pdfUrl) {
			try {
				const response = await cloudFetch(
					`/api/remote-pdf?url=${encodeURIComponent(pdfUrl)}`,
					{ signal },
				);
				const data = await response.blob();
				await persist([{ path: `${rel}/paper.pdf`, data }]);
				result.pdf = true;
			} catch (error) {
				signal?.throwIfAborted();
				result.errors.push(
					error instanceof Error ? error.message : "downloadFailed",
				);
			}
		}
		if (!result.tex && paper.arxiv_id) {
			try {
				const response = await cloudFetch(
					`/api/arxiv-source?id=${encodeURIComponent(paper.arxiv_id)}`,
					{ signal },
				);
				const entries = await unpackArxivSource(await response.blob(), signal);
				await persist(
					entries.map((entry) => ({
						path: `${rel}/source/${entry.path}`,
						data: new Blob([new Uint8Array(entry.data)]),
					})),
				);
				result.tex = true;
			} catch (error) {
				signal?.throwIfAborted();
				result.errors.push(
					error instanceof Error ? error.message : "downloadFailed",
				);
			}
		}
		if (!result.pdf && !result.tex && !result.paperMd && !result.errors.length)
			result.errors.push("pdfMissing");
		return result;
	});
}
