/**
 * Import a paper from a 广场 source into the vault.
 *
 * Two routes, because they are not equally good:
 *
 * - **arXiv rows** keep the 魔棒 path with the arxiv.org URL: the browser
 *   arXiv handling additionally yields `arxiv_id` and the LaTeX source.
 * - **Everything else** goes to the browser Highwire importer, which reads the row's
 *   own papers.cool page. That page carries Highwire `citation_*` metadata for
 *   all 11 publisher shapes papers.cool aggregates — including the PDF URL —
 *   whereas routing the publisher URL through the Translator fails outright for
 *   several (OpenReview serves a bot challenge, AAAI OJS 500s) and never returns
 *   a PDF for any of them.
 */

import i18n from "@/i18n";
import { cloudAiError } from "@/lib/cloud/ai";
import { importCoolPaper } from "@/lib/cloud/coolpapers";
import { errorText } from "@/lib/core/error";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/core/notify";
import { runLocalActivity } from "@/lib/core/tasks";
import { lookupSubmit } from "@/lib/paper/import-actions";
import { currentLookupParentDir } from "@/lib/paper/library-actions";
import { refreshLibrary } from "@/lib/paper/library-store";
import { getVaultPath, refreshTree } from "@/lib/vault/store";

export type PlazaImportRequest = {
	/** Source-local row id, echoed back so the frame can settle that row. */
	id: string;
	/** papers.cool branch (`arxiv` / `venue`). */
	branch?: string;
	/** Upstream landing page for the row. */
	url: string;
	title: string | null;
};

/**
 * The 魔棒 import settles through `onComplete`, which this frame does not
 * await, so a failure in there never reaches our `catch`. Settle regardless
 * after this long so the row cannot stay stuck pending; the tasks panel still
 * reports the real error. A retry is harmless — the Host dedupes by id.
 */
const SETTLE_TIMEOUT_MS = 120_000;

function isArxivRow(request: PlazaImportRequest): boolean {
	if (request.branch === "arxiv") return true;
	try {
		const host = new URL(request.url).hostname;
		return host === "arxiv.org" || host.endsWith(".arxiv.org");
	} catch {
		return false;
	}
}

/** arXiv rows: reuse 魔棒 so `arxiv_id` and the LaTeX source come along. */
function importViaLookup(request: PlazaImportRequest): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const timer = setTimeout(() => settle(false), SETTLE_TIMEOUT_MS);
		function settle(ok: boolean) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(ok);
		}
		void lookupSubmit([request.url], {
			onComplete: (result) =>
				settle(
					result.imported.length > 0 ||
						result.skipped.some((item) => item.reason === "already_in_library"),
				),
		}).catch((error) => {
			notifyError(errorText(error));
			settle(false);
		});
	});
}

/** Everything else: read the row's papers.cool page, no Translator involved. */
async function importViaPage(
	request: PlazaImportRequest,
	vaultPath: string,
): Promise<boolean> {
	const result = await runLocalActivity(
		{
			kind: "plazaImport",
			title: i18n.t("app:plazaImport.taskTitle"),
			detail: request.title || request.id,
		},
		({ signal }) =>
			importCoolPaper(
				request.branch || "venue",
				request.id,
				currentLookupParentDir(),
				signal,
			),
	);
	await refreshTree(vaultPath);
	await refreshLibrary();
	if (result.alreadyInLibrary)
		notifyWarning(
			i18n.t("app:plazaImport.duplicate", { name: result.paper.title }),
		);
	else if (result.hasPdf)
		notifySuccess(
			i18n.t("app:plazaImport.imported", { name: result.paper.title }),
		);
	else
		notifyWarning(
			i18n.t("app:plazaImport.importedNoPdf", { name: result.paper.title }),
		);
	for (const error of result.errors)
		notifyError(cloudAiError(new Error(error)));
	return true;
}

/**
 * Resolves `true` when the paper is in the library afterwards.
 *
 * Does not open the imported paper — that would pull the user out of the
 * browsing panel, which is the wrong trade while importing several in a row.
 */
export async function importPlazaPaper(
	request: PlazaImportRequest,
): Promise<boolean> {
	const vaultPath = getVaultPath();
	if (!vaultPath) {
		notifyError(i18n.t("app:plazaImport.needsVault"));
		return false;
	}
	if (!request.id.trim()) {
		notifyWarning(i18n.t("app:plazaImport.missingId"));
		return false;
	}

	try {
		return isArxivRow(request)
			? await importViaLookup(request)
			: await importViaPage(request, vaultPath);
	} catch (error) {
		notifyError(errorText(error));
		return false;
	}
}

/** Feed a GitHub Skill repo into the 魔棒 discovery → install dialog. */
export async function importPlazaSkillRepo(url: string): Promise<void> {
	try {
		await lookupSubmit([url]);
	} catch (error) {
		notifyError(errorText(error));
	}
}
