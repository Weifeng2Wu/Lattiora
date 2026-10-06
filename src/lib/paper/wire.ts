/**
 * IPC → domain fold for paper payloads. The single unchecked step at the
 * boundary: `status`, `body_source` and `body_quality` are plain `String`
 * columns in the catalog, so they are trusted as the unions in `types.ts`, and
 * `tags` arrive as a mixed array because the Host serializes an uncolored tag
 * as a bare string.
 */
import type { PaperRecord_Serialize } from "@/lib/core/bindings";
import { coercePaperTags } from "@/lib/paper/tags";
import type { PaperMetadata } from "@/lib/paper/types";

export function paperFromWire<T extends PaperRecord_Serialize>(
	record: T,
): T & PaperMetadata {
	return {
		...record,
		tags: coercePaperTags(record.tags),
	} as T & PaperMetadata;
}
