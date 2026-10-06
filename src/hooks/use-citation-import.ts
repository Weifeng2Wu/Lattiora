import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/hooks/use-app-stores";
import { usePapersOrgFolders } from "@/hooks/use-papers-org-folders";
import { errorText } from "@/lib/core/error";
import { notifyError } from "@/lib/core/notify";
import { resolvePapersParentDir } from "@/lib/paper/detect";
import { lookupSubmit } from "@/lib/paper/import-actions";
import { currentLookupParentDir } from "@/lib/paper/library-actions";
import {
	type Citation,
	type CiteSidecar,
	citationImportIdentifier,
	paperRefsParse,
} from "@/lib/paper/refs";

/**
 * Magic-wand import of one citation into the library, shared by the References
 * panel cards and the PDF citation hover card: folder list, remembered target
 * folder, in-flight id, and the import itself (re-parses the origin paper's
 * sidecar afterwards so `localMatch` refreshes).
 */
export function useCitationImport(
	vaultPath: string | null,
	paperPath: string | null,
	setSidecar: (sidecar: CiteSidecar | null) => void,
): {
	folders: string[];
	lastImportParentDir: string;
	importingId: string | null;
	importCitation: (citation: Citation, parentDir: string) => Promise<void>;
} {
	const { t } = useTranslation("viewer");
	const tree = useVaultStore((s) => s.tree);
	const folders = usePapersOrgFolders(vaultPath, tree);
	const [importingId, setImportingId] = useState<string | null>(null);
	const paperPathRef = useRef(paperPath);
	paperPathRef.current = paperPath;

	const [lastImportParentDir, setLastImportParentDir] = useState(() =>
		vaultPath && paperPath
			? resolvePapersParentDir(vaultPath, paperPath, tree)
			: currentLookupParentDir(),
	);
	useEffect(() => {
		setLastImportParentDir(
			vaultPath && paperPath
				? resolvePapersParentDir(vaultPath, paperPath, tree)
				: currentLookupParentDir(),
		);
	}, [vaultPath, paperPath, tree]);

	const importCitation = useCallback(
		async (citation: Citation, parentDir: string) => {
			const identifier = citationImportIdentifier(citation);
			if (!identifier || !vaultPath || !paperPath) return;
			setImportingId(citation.id);
			setLastImportParentDir(parentDir);
			const origin = paperPath;
			try {
				await lookupSubmit([identifier], {
					parentDir,
					onComplete: async () => {
						try {
							const parsed = await paperRefsParse(vaultPath, origin, true);
							if (paperPathRef.current === origin) setSidecar(parsed);
						} catch (error) {
							notifyError(t("references.importFailed"), {
								description: errorText(error),
							});
						}
					},
				});
			} catch (error) {
				notifyError(t("references.importFailed"), {
					description: errorText(error),
				});
			} finally {
				setImportingId(null);
			}
		},
		[vaultPath, paperPath, t, setSidecar],
	);

	return { folders, lastImportParentDir, importingId, importCitation };
}
