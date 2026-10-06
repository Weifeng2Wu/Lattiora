/**
 * Render a single-line title/label that may embed TeX (`$\\pi$`, `\\(...\\)`).
 * Plain strings without math delimiters stay as a text node (no KaTeX cost).
 */
import { Fragment, memo, useMemo } from "react";
import { cn } from "@/lib/core/utils";
import { getKatexHtml } from "@/lib/math/katex-cache";
import { hasTitleMath, parseTitleMath } from "@/lib/paper/title-math";

const KATEX_OPTIONS = {
	displayMode: false,
	throwOnError: false,
	errorColor: "#cc0000",
	strict: "ignore" as const,
	trust: false,
	output: "html" as const,
};

function renderInlineMath(tex: string): string {
	try {
		return getKatexHtml(tex, KATEX_OPTIONS);
	} catch {
		// Keep the source visible when KaTeX rejects the expression.
		return tex;
	}
}

export type MathTextProps = {
	text: string;
	className?: string;
	/** Native tooltip; defaults to the raw `text` (with TeX source). */
	title?: string;
};

export const MathText = memo(function MathText({
	text,
	className,
	title,
}: MathTextProps) {
	const htmlTitle = title ?? text;
	const content = useMemo(() => {
		if (!hasTitleMath(text)) return null;
		return parseTitleMath(text).map((segment, index) => {
			const key = `${segment.kind}:${segment.value}:${index}`;
			if (segment.kind === "text") {
				return <Fragment key={key}>{segment.value}</Fragment>;
			}
			const html = renderInlineMath(segment.value);
			return (
				<span
					key={key}
					className="math-text__tex"
					// KaTeX HTML from local TeX with trust:false — not user HTML.
					// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX renderToString
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			);
		});
	}, [text]);

	if (!content) {
		return (
			<span className={className} title={htmlTitle}>
				{text}
			</span>
		);
	}

	return (
		<span
			className={cn(
				// Keep KaTeX on the title's font size / line box so truncate works.
				"[&_.katex]:text-[1em] [&_.katex]:leading-none [&_.katex-html]:inline",
				className,
			)}
			title={htmlTitle}
		>
			{content}
		</span>
	);
});
