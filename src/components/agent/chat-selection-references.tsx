import { useTranslation } from "react-i18next";
import { SelectionSourceButton } from "@/components/selection/selection-source-button";
import type { SelectionContext } from "@/lib/agent/selection-store";
/** Immutable quotes sent with this local turn; editing the next draft cannot change them. */
export function ChatSelectionReferences({
	selections,
}: {
	selections: SelectionContext[];
}) {
	const { t } = useTranslation("viewer");
	if (!selections.length) return null;
	return (
		<details
			className="mb-2 ml-auto max-w-full rounded-lg border px-3 py-2 text-sm"
			data-annotation-ui
		>
			<summary className="cursor-pointer text-muted-foreground">
				{t("selection.annotationCount", { count: selections.length })}
			</summary>
			<ol className="mt-2 max-h-80 divide-y overflow-auto">
				{selections.map((selection, index) => (
					<li key={selection.id} className="py-2">
						<SelectionSourceButton selection={selection} />
						<blockquote className="whitespace-pre-wrap break-words border-l-2 pl-2 text-muted-foreground">
							{index + 1}. {selection.text}
						</blockquote>
						{selection.comment && (
							<p className="mt-2 whitespace-pre-wrap break-words">
								{selection.comment}
							</p>
						)}
					</li>
				))}
			</ol>
		</details>
	);
}
