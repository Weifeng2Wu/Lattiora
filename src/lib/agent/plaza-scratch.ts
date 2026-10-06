/** arXiv mention cache backed by the same offline file store as the workspace. */
import { plazaMentionArxivId } from "@/lib/agent/plaza-mention";
import { cloudAiError } from "@/lib/cloud/ai";
import {
	listLocalFiles,
	readLocalFile,
	removeLocal,
	writeLocalFile,
} from "@/lib/cloud/files";
import { cloudFetch } from "@/lib/cloud/sync";
import { notifyError } from "@/lib/core/notify";

const PREFIX = ".agentero/plaza-scratch/";
export type PlazaScratchStats = { papers: number; bytes: number };
export type PlazaScratchClearResult = { freedBytes: number };
export async function preparePlazaScratch(
	plazaPaths: readonly string[],
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	for (const path of new Set(plazaPaths)) {
		const id = plazaMentionArxivId(path);
		if (!id || !/^\d{4}\.\d{4,5}$/.test(id)) continue;
		const folder = `${PREFIX}${id}`;
		const markdown = `${folder}/source/parsed.md`;
		try {
			const files = await listLocalFiles();
			if (!files.some((f) => !f.deleted && f.path === markdown && f.data)) {
				const pdf = `${folder}/paper.pdf`;
				if (!files.some((f) => !f.deleted && f.path === pdf && f.data)) {
					const response = await cloudFetch(
						`/api/remote-pdf?url=${encodeURIComponent(`https://arxiv.org/pdf/${id}`)}`,
					);
					await writeLocalFile(pdf, await response.blob());
				}
				const { extractCloudPdf } = await import("@/lib/cloud/pdf");
				const parsed = await extractCloudPdf(pdf);
				if (parsed.scannedPages.length) throw new Error("scannedPdf");
				await writeLocalFile(
					markdown,
					new Blob([parsed.text], { type: "text/markdown" }),
				);
			}
			await readLocalFile(markdown);
			result.set(path, `/cloud/${markdown}`);
		} catch (error) {
			notifyError(cloudAiError(error));
		} // original composer explicitly falls back to the abstract
	}
	return result;
}
export async function plazaScratchStats(): Promise<PlazaScratchStats> {
	const files = (await listLocalFiles()).filter(
		(f) => !f.deleted && f.path.startsWith(PREFIX),
	);
	return {
		papers: new Set(files.map((f) => f.path.slice(PREFIX.length).split("/")[0]))
			.size,
		bytes: files.reduce((sum, f) => sum + f.size, 0),
	};
}
export async function plazaScratchClear(): Promise<PlazaScratchClearResult> {
	const stats = await plazaScratchStats();
	await removeLocal(PREFIX.slice(0, -1), true);
	return { freedBytes: stats.bytes };
}
