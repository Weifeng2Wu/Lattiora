import type { TFunction } from "i18next";
import { Quote, ScanSearch, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextPathIcon } from "@/components/agent/context-path-icon";
import type { SelectionContext } from "@/lib/agent/selection-store";
import type { PdfVisualDraft } from "@/lib/agent/visual-context-store";
import { basenameOf } from "@/lib/core/path";
import { cn, truncateToChars } from "@/lib/core/utils";

const MAX_CHIP_TITLE_CHARS = 9;

/**
 * Icon-first chip: hover / focus animates width open to reveal a short label + X.
 * No `title` tooltip — the expand is the reveal.
 */
function ChipExpandTrail({
	label,
	withRemove,
}: {
	label: string;
	withRemove?: boolean;
}) {
	const trimmed = label.trim();
	if (!trimmed && !withRemove) return null;
	return (
		<span
			className={cn(
				"grid min-w-0 transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none",
				"grid-cols-[0fr] group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]",
			)}
		>
			<span className="min-w-0 overflow-hidden">
				<span className="ml-1 flex max-w-[8rem] items-center gap-1 whitespace-nowrap">
					{trimmed ? (
						<span className="min-w-0 truncate text-xs leading-none">
							{trimmed}
						</span>
					) : null}
					{withRemove ? (
						<X className="size-3 shrink-0 text-muted-foreground" aria-hidden />
					) : null}
				</span>
			</span>
		</span>
	);
}

function chipShellClass(extra?: string) {
	return cn(
		"group inline-flex h-7 max-w-full items-center rounded-full border bg-muted/20 px-1.5 text-foreground text-xs transition-colors hover:bg-muted",
		extra,
	);
}

/**
 * Code-editor selection chip label — `main.tex 75-77行` (single line:
 * `main.tex 75行`). Null for selections without a line span (PDF page
 * chips / plain markdown quotes). Composer context chips only — the
 * inline-input quote chip stays filename-only.
 */
function selectionLineChipLabel(
	t: TFunction<"agent", undefined>,
	sel: Pick<SelectionContext, "lineFrom" | "lineTo">,
	title: string,
): string | null {
	const { lineFrom, lineTo } = sel;
	if (lineFrom == null) return null;
	if (lineTo != null && lineTo > lineFrom) {
		return t("composer.selectionChipWithLines", {
			title,
			from: lineFrom,
			to: lineTo,
		});
	}
	return t("composer.selectionChipWithLine", { title, from: lineFrom });
}

export function ComposerContextChips({
	currentFilePath,
	currentFileLabel,
	mentionChipPaths,
	selectionChips,
	onRemoveSelection,
	visualDrafts,
	onRemoveVisualDraft,
	directoryPathSet,
	paperPathSet,
	labelForPath,
	onRemoveContextPath,
}: {
	/** @deprecated Ignored — chips always expand on hover. */
	compact?: boolean;
	currentFilePath: string | null;
	currentFileLabel: string;
	mentionChipPaths: string[];
	selectionChips: SelectionContext[];
	onRemoveSelection: (id: string) => void;
	visualDrafts: PdfVisualDraft[];
	onRemoveVisualDraft: (id: string) => void;
	directoryPathSet: ReadonlySet<string>;
	paperPathSet: ReadonlySet<string>;
	labelForPath: (path: string) => string;
	onRemoveContextPath: (path: string) => void;
}) {
	const { t } = useTranslation("agent");
	if (
		!currentFilePath &&
		mentionChipPaths.length === 0 &&
		selectionChips.length === 0 &&
		visualDrafts.length === 0
	) {
		return null;
	}

	return (
		<>
			{currentFilePath ? (
				<button
					type="button"
					className={chipShellClass()}
					onClick={() => onRemoveContextPath(currentFilePath)}
					aria-label={t("composer.currentFileRemove")}
				>
					<ContextPathIcon
						path={currentFilePath}
						directoryPaths={directoryPathSet}
						paperPaths={paperPathSet}
					/>
					<ChipExpandTrail
						label={
							currentFileLabel.trim() ||
							basenameOf(currentFilePath) ||
							currentFilePath
						}
						withRemove
					/>
				</button>
			) : null}
			{mentionChipPaths.map((path) => {
				const shortLabel = basenameOf(path) || labelForPath(path);
				return (
					<button
						key={path}
						type="button"
						className={chipShellClass()}
						onClick={() => onRemoveContextPath(path)}
						aria-label={t("composer.removeContext", { path })}
					>
						<ContextPathIcon
							path={path}
							directoryPaths={directoryPathSet}
							paperPaths={paperPathSet}
						/>
						<ChipExpandTrail label={shortLabel} withRemove />
					</button>
				);
			})}
			{selectionChips.map((sel) => {
				const name = truncateToChars(
					basenameOf(sel.sourcePath) || t("composer.selection"),
					MAX_CHIP_TITLE_CHARS,
				);
				const shortLabel =
					(sel.page ? `${name} · p.${sel.page}` : null) ??
					selectionLineChipLabel(t, sel, name) ??
					name;
				return (
					<button
						key={sel.id}
						title={[sel.text, sel.comment].filter(Boolean).join("\n\n")}
						type="button"
						className={chipShellClass(
							sel.pinned ? undefined : "border-dashed bg-transparent",
						)}
						onClick={() => onRemoveSelection(sel.id)}
						aria-label={t("composer.removeSelection")}
					>
						<Quote className="size-3.5 shrink-0 text-muted-foreground" />
						<ChipExpandTrail label={shortLabel} withRemove />
					</button>
				);
			})}
			{visualDrafts.map((draft) => {
				const pageLabel = t("composer.visualAnnotationPage", {
					page: draft.page,
				});
				const shortLabel = draft.comment.trim() || pageLabel;
				const thumb =
					draft.image.data.length > 0
						? `data:${draft.image.mimeType || "image/png"};base64,${draft.image.data}`
						: null;
				return (
					<button
						key={draft.id}
						type="button"
						className={chipShellClass()}
						onClick={() => onRemoveVisualDraft(draft.id)}
						aria-label={t("composer.removeVisualDraft")}
					>
						{thumb ? (
							<img
								src={thumb}
								alt=""
								className="size-5 shrink-0 rounded-full object-cover"
							/>
						) : (
							<ScanSearch className="size-3.5 shrink-0 text-muted-foreground" />
						)}
						<ChipExpandTrail label={shortLabel} withRemove />
					</button>
				);
			})}
		</>
	);
}
