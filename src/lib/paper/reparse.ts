import i18n from "@/i18n";
import { cloudAiError } from "@/lib/cloud/ai";
import { listCloudPapers } from "@/lib/cloud/catalog";
import { cloudLock, localTransaction } from "@/lib/cloud/db";
import { cloudRelative, editedFile, filesChanged } from "@/lib/cloud/files";
import { parseCloudPaper, parseCloudPaperBody } from "@/lib/cloud/pdf";
import type {
	ClearAndReparseResult,
	ClearParseResultsResult,
	ParseResultScope,
} from "@/lib/core/bindings";
import { notifyError } from "@/lib/core/notify";
import { runLocalActivity } from "@/lib/core/tasks";
import { workspaceStore } from "@/lib/workspace/store";

export type {
	ClearAndReparseResult,
	ClearParseResultsResult,
	ParseResultScope,
};

/** Preserve all removed generated files in a dated backup, atomically with deletion. */
export async function clearParseResults(
	_vaultPath: string,
	scope: ParseResultScope,
): Promise<ClearParseResultsResult> {
	const papers = await listCloudPapers();
	const candidates = new Set<string>();
	for (const paper of papers) {
		if (scope !== "paper")
			for (const name of ["layout.json", "layout-index.json", "parsed.md"])
				candidates.add(`${paper.path}/source/${name}`);
		if (scope !== "layout") candidates.add(`${paper.path}/PAPER.md`);
	}
	const root = `Backups/parse-${crypto.randomUUID()}`;
	const changed = await cloudLock("files", () =>
		localTransaction((files) => {
			for (const tab of workspaceStore.getState().tabs)
				if (
					(tab.markdownDirty || tab.textDirty) &&
					candidates.has(cloudRelative(tab.path))
				)
					throw new Error(i18n.t("cloud:doctor.dirtyDocument"));
			const changed: string[] = [];
			for (const path of candidates) {
				const old = files.get(path);
				if (!old || old.deleted) continue;
				if (!old.data) throw new Error("notCached");
				files.set(`${root}/${path}`, editedFile(`${root}/${path}`, old.data));
				files.set(path, editedFile(path, null, old));
				changed.push(path);
			}
			return changed;
		}),
	);
	filesChanged([...changed, root]);
	return { papersScanned: papers.length, filesRemoved: changed.length };
}
export async function clearAndReparse(
	vaultPath: string,
	scope: ParseResultScope,
): Promise<ClearAndReparseResult> {
	const result = await clearParseResults(vaultPath, scope);
	const papers = (await listCloudPapers()).filter((p) => p.has_pdf);
	// Serial tasks respect free-tier request limits and keep the original task-panel controls.
	void (async () => {
		for (const paper of papers) {
			try {
				await runLocalActivity(
					{ kind: "layoutRun", title: paper.title, detail: paper.path },
					async ({ signal }) => {
						if (scope !== "paper")
							await parseCloudPaper(paper.path, { signal, force: true });
						if (scope !== "layout")
							await parseCloudPaperBody(paper.path, signal, true);
					},
				);
			} catch (error) {
				notifyError(cloudAiError(error));
			}
		}
	})();
	return {
		...result,
		layoutEnqueued: scope === "paper" ? 0 : papers.length,
		paperEnqueued: scope === "layout" ? 0 : papers.length,
	};
}
