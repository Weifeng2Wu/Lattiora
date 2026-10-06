import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { renderTexPreview, TEX_PREVIEW_MAX_LENGTH } from "@/lib/tex/preview";
import "katex/dist/katex.min.css";
import "./latex-preview.css";

export default function LatexPreview({ source }: { source: string }) {
	const { t, i18n } = useTranslation("viewer");
	const bibliographyTitle = t("texPreview.references");
	const today = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
		dateStyle: "long",
	}).format(new Date());
	const [html, setHtml] = useState(() =>
		renderTexPreview(source, { bibliographyTitle, today }),
	);
	useEffect(() => {
		const timer = setTimeout(
			() => setHtml(renderTexPreview(source, { bibliographyTitle, today })),
			200,
		);
		return () => clearTimeout(timer);
	}, [source, bibliographyTitle, today]);
	return (
		<section
			aria-label={t("texPreview.title")}
			className="agentero-scroll h-full min-h-0 overflow-auto bg-background px-6 pt-12 pb-8"
		>
			<p className="mb-6 text-muted-foreground text-xs">
				{t("texPreview.scope")}
			</p>
			{source.length > TEX_PREVIEW_MAX_LENGTH ? (
				<p className="text-muted-foreground text-sm">
					{t("texPreview.tooLarge")}
				</p>
			) : (
				<div
					className="tex-preview mx-auto max-w-[70ch] break-words text-sm leading-relaxed"
					// Author text is escaped by the subset renderer; formulas use trust:false KaTeX.
					// biome-ignore lint/security/noDangerouslySetInnerHtml: only escaped text and generated markup
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			)}
		</section>
	);
}
