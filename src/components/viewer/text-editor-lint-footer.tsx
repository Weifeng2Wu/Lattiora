import { forEachDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/core/utils";

/**
 * IDE-style lint status bar for the text editor: per-severity counts
 * (error / warning / info) with an icon, and a hover card listing every
 * diagnostic — click a card to jump to the offending span.
 */

export type LintSeverity = "error" | "warning" | "info";

export type EditorDiagnostic = {
	from: number;
	to: number;
	severity: LintSeverity;
	message: string;
	/** 1-based position of the diagnostic start, IDE-style. */
	line: number;
	column: number;
};

/**
 * Collect the current lint diagnostics with 1-based line/column, in document
 * order. Severity-less diagnostics default to warning so the footer never
 * drops a finding.
 */
export function collectEditorDiagnostics(
	state: EditorState,
): EditorDiagnostic[] {
	const found: EditorDiagnostic[] = [];
	forEachDiagnostic(state, (diagnostic, from, to) => {
		const severity: LintSeverity =
			diagnostic.severity === "error" || diagnostic.severity === "info"
				? diagnostic.severity
				: "warning";
		const line = state.doc.lineAt(from);
		found.push({
			from,
			to,
			severity,
			message: diagnostic.message,
			line: line.number,
			column: from - line.from + 1,
		});
	});
	found.sort((a, b) => a.from - b.from || a.to - b.to);
	return found;
}

/**
 * Push the diagnostics to React whenever a lint run lands. The lint state
 * field is private to @codemirror/lint, but its setDiagnostics effect is the
 * public signal that a run replaced the markers (both lint sources dispatch
 * one merged transaction per run, so this fires once per run).
 */
export function lintDiagnosticsWatcher(
	onDiagnostics: (diagnostics: EditorDiagnostic[]) => void,
): Extension {
	return EditorView.updateListener.of((update) => {
		const replaced = update.transactions.some((tr) =>
			tr.effects.some((effect) => effect.is(setDiagnosticsEffect)),
		);
		if (!replaced) return;
		onDiagnostics(collectEditorDiagnostics(update.state));
	});
}

// Literal keys keep react-i18next's typed t() on the (key, options)
// overload — a plain `string` key falls through to (key, defaultValue).
type CountKey =
	| "textEditor.errorCount"
	| "textEditor.warningCount"
	| "textEditor.infoCount";

const SEVERITY_META: Record<
	LintSeverity,
	{ Icon: LucideIcon; iconClasses: string; countKey: CountKey }
> = {
	error: {
		Icon: CircleAlert,
		iconClasses: "text-destructive",
		countKey: "textEditor.errorCount",
	},
	warning: {
		Icon: TriangleAlert,
		iconClasses: "text-amber-600 dark:text-amber-500",
		countKey: "textEditor.warningCount",
	},
	info: {
		Icon: Info,
		iconClasses: "text-sky-600 dark:text-sky-500",
		countKey: "textEditor.infoCount",
	},
};

const SEVERITY_ORDER: LintSeverity[] = ["error", "warning", "info"];

/**
 * The counts double as the hover target: resting on them reveals the problem
 * list as cards (document order, severity icon + message + L{line}:C{col});
 * clicking a card selects and scrolls to the span. Pure CSS hover — no
 * popover state to fight the editor's focus. The group is NAMED: the editor
 * wrapper also carries a bare `group` (toolbar hover chrome), and a bare
 * `group-hover` here would match it and pop the card from anywhere in the
 * editor.
 */
export function TextEditorLintFooter({
	diagnostics,
	onJump,
}: {
	diagnostics: EditorDiagnostic[];
	onJump: (diagnostic: EditorDiagnostic) => void;
}) {
	const { t } = useTranslation("viewer");
	const counts: Record<LintSeverity, number> = {
		error: 0,
		warning: 0,
		info: 0,
	};
	for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1;

	return (
		<div className="flex h-7 shrink-0 items-center border-t bg-muted/30 px-3">
			<div className="group/lint relative flex items-center gap-3">
				{SEVERITY_ORDER.map((severity) => {
					const { Icon, iconClasses, countKey } = SEVERITY_META[severity];
					const count = counts[severity];
					return (
						<span
							key={severity}
							className={cn(
								"flex items-center gap-1 font-mono text-xs text-muted-foreground",
								count === 0 && "opacity-45",
							)}
						>
							<Icon className={cn("size-3.5", iconClasses)} aria-hidden />
							{count}
							<span className="sr-only">{t(countKey, { count })}</span>
						</span>
					);
				})}
				{diagnostics.length > 0 ? (
					<div className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-1.5 max-h-72 w-[28rem] overflow-y-auto rounded-md border bg-popover p-1 text-foreground opacity-0 shadow-lg transition-opacity group-hover/lint:pointer-events-auto group-hover/lint:visible group-hover/lint:opacity-100">
						{diagnostics.map((diagnostic) => {
							const { Icon, iconClasses } = SEVERITY_META[diagnostic.severity];
							return (
								<button
									type="button"
									key={`${diagnostic.from}:${diagnostic.to}:${diagnostic.message}`}
									onClick={() => onJump(diagnostic)}
									className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
								>
									<Icon
										className={cn("mt-0.5 size-3.5 shrink-0", iconClasses)}
										aria-hidden
									/>
									<span className="min-w-0 flex-1 text-xs leading-snug">
										{diagnostic.message}
									</span>
									<span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
										L{diagnostic.line}:C{diagnostic.column}
									</span>
								</button>
							);
						})}
					</div>
				) : null}
			</div>
		</div>
	);
}
