/** Original NOTES toolbar action backed by public web data and guarded local appends. */
import i18n from "@/i18n";
import { cloudAiError } from "@/lib/cloud/ai";
import {
	appendCoolAnalysis,
	fetchCoolAnalysis,
} from "@/lib/cloud/coolpapers-notes";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/core/notify";
import { runLocalActivity } from "@/lib/core/tasks";
import { resolvePaperCatalogRel } from "@/lib/paper/library-actions";
import type { PaperMetadata } from "@/lib/paper/types";
import { joinVaultPath, readVaultFile } from "@/lib/vault";
import { getVaultPath } from "@/lib/vault/store";
import { dirtyVaultPaths } from "@/lib/workspace/actions";
import { refreshTabNotes } from "@/lib/workspace/store";

export async function fetchCoolPapersNotes(meta: PaperMetadata): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	const rel = await resolvePaperCatalogRel(meta);
	if (!rel) {
		notifyError(i18n.t("app:coolPapers.resolveFailed"));
		return;
	}
	const notes = `${rel}/NOTES.md`;
	const guard = () => {
		if (dirtyVaultPaths(vaultPath).includes(notes))
			throw new Error("dirtyDocument");
	};
	try {
		guard();
		const result = await runLocalActivity(
			{
				kind: "coolNotes",
				title: i18n.t("app:coolPapers.fetchTask"),
				detail: meta.title,
			},
			async ({ signal }) => {
				const analysis = await fetchCoolAnalysis(meta, signal);
				if (!analysis) return null;
				return appendCoolAnalysis(rel, analysis, { signal, guard });
			},
		);
		if (result === null) {
			notifyWarning(i18n.t("app:coolPapers.notFound"));
			return;
		}
		if (!result) {
			notifySuccess(i18n.t("app:coolPapers.alreadyInNotes"));
			return;
		}
		// Never reseed a buffer the user started editing while the request was in flight.
		if (!dirtyVaultPaths(vaultPath).includes(notes)) {
			const content = await readVaultFile(joinVaultPath(vaultPath, notes));
			if (!dirtyVaultPaths(vaultPath).includes(notes))
				refreshTabNotes(joinVaultPath(vaultPath, rel), content);
		}
		notifySuccess(i18n.t("app:coolPapers.appended"));
	} catch (error) {
		notifyError(cloudAiError(error));
	}
}
