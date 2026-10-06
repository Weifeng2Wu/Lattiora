import type {
	PaperListRow_Serialize,
	PaperRecord_Serialize,
} from "@/lib/core/bindings";
import type { TagColorId } from "@/lib/ui/tag-colors";

/** Paper tag (catalog `tags_json`): name + optional preset color id. */
export type PaperTag = {
	name: string;
	/** Preset id; omit / null = default muted chip */
	color?: TagColorId | null;
};

/**
 * Accept catalog / API payloads: the `PaperTag` serializer writes a bare
 * string for uncolored tags and `{ name, color }` for colored ones, so IPC
 * rows really are mixed.
 */
export type PaperTagInput = string | PaperTag;

export type PaperStatus = "pending" | "importing" | "completed" | "failed";

export type PaperBodySource =
	| "latex"
	| "html"
	| "pdf"
	| "ocr"
	| "mineru"
	| "paddle"
	| "vlm";

export type PaperBodyQuality = "high" | "medium" | "low";

/**
 * Paper metadata: the generated `PaperRecord` IPC payload.
 * `status` / `body_source` / `body_quality` are still plain `String` columns on
 * the Rust side, so they are narrowed back to their real unions here — do not
 * "simplify" the Omit into a bare alias.
 */
export type PaperMetadata = Omit<
	PaperRecord_Serialize,
	"status" | "body_source" | "body_quality" | "tags"
> & {
	tags: PaperTagInput[];
	status: PaperStatus;
	body_source?: PaperBodySource | null;
	body_quality?: PaperBodyQuality | null;
};

/**
 * Library list row: `paper_list` pairs the catalog record with a local-PDF
 * probe. `remote_paper_list` returns bare records, so remote rows carry
 * `has_pdf: undefined` — "not probed", never "no local PDF".
 */
export type PaperLibraryRow = PaperMetadata & {
	has_pdf: PaperListRow_Serialize["has_pdf"] | undefined;
};

/** Remote http(s) URL (HTML preview; PDF download candidate / fallback). */
export type RemoteAsset = { url: string };

/** How the PDF viewer source was resolved. */
export type PaperPdfOrigin = "local" | "remote";
