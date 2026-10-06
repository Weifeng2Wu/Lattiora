/**
 * Paper-layer wiring for background-task labels.
 *
 * The helpers live in `lib/core/task-label` so JobCenter can use them without
 * depending on the paper domain. This module registers the catalog title
 * lookup and re-exports the helpers for paper callers / tests.
 */

import {
	joinTaskDetail,
	paperTaskLabel,
	registerPaperTitleLookup,
} from "@/lib/core/task-label";
import { libraryStore } from "@/lib/paper/library-store";

registerPaperTitleLookup(
	(normalizedPaperRel) =>
		libraryStore.getState().paperMetaByRelPath.get(normalizedPaperRel)?.title,
);

export { joinTaskDetail, paperTaskLabel };
