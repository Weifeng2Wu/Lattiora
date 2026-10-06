import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import type { NoteShareSnapshot } from "@/lib/cloud/share-protocol";
import "katex/dist/katex.min.css";

const plugins = {
	cjk,
	code,
	math: createMathPlugin({ singleDollarTextMath: true }),
};
// Public documents never turn author-supplied HTML into DOM elements.
const rehypePlugins = Object.entries(defaultRehypePlugins)
	.filter(([name]) => name !== "raw")
	.map(([, plugin]) => plugin);
const noteIndex = () => Number(/^#note=(\d+)$/.exec(location.hash)?.[1] ?? 0);
function publicUrl(value: string, key: string): string | undefined {
	if (key === "href" && value.startsWith("#")) return value;
	if (
		key === "src" &&
		/^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(value)
	)
		return value;
	try {
		const url = new URL(value);
		if (key === "href" && url.protocol === "mailto:") return value;
		if (
			(url.protocol === "https:" || url.protocol === "http:") &&
			url.origin !== location.origin
		)
			return value;
	} catch {
		/* Workspace-relative links never fetch private data. */
	}
	return undefined;
}

/** A standalone reader: no editor, vault providers, or workspace initialization. */
export default function SharedMarkdown({
	notes,
}: {
	notes: NoteShareSnapshot["notes"];
}) {
	const { t } = useTranslation("editor");
	const [index, setIndex] = useState(noteIndex);
	const article = useRef<HTMLElement>(null);
	const note = notes[index] ?? notes[0];
	useEffect(() => {
		const change = () => setIndex(noteIndex());
		window.addEventListener("hashchange", change);
		return () => window.removeEventListener("hashchange", change);
	}, []);
	useEffect(() => {
		void note;
		article.current?.scrollIntoView({ block: "start" });
	}, [note]);
	return (
		<article
			ref={article}
			className="mx-auto w-full min-w-0 max-w-4xl px-5 py-8 sm:px-10 sm:py-12"
		>
			{note !== notes[0] && (
				<Button asChild variant="ghost" size="sm" className="mb-6">
					<a href="#note=0">
						<ArrowLeft className="size-4" aria-hidden />
						{t("share.backToNote")}
					</a>
				</Button>
			)}
			<Streamdown
				key={index}
				mode="static"
				controls={false}
				skipHtml
				rehypePlugins={rehypePlugins}
				plugins={plugins}
				urlTransform={publicUrl}
				linkSafety={{ enabled: false }}
				className="w-full min-w-0 break-words text-base leading-relaxed [overflow-wrap:anywhere] [&>*:first-child]:mt-0"
				components={{
					a: ({ href, children }) =>
						href ? (
							<a
								href={href}
								className="text-primary underline underline-offset-4"
								target={href.startsWith("#") ? undefined : "_blank"}
								rel="noopener noreferrer"
							>
								{children}
							</a>
						) : (
							<span>{children}</span>
						),
					img: ({ src, alt }) =>
						typeof src === "string" && src ? (
							<img
								src={src}
								alt={alt ?? ""}
								referrerPolicy="no-referrer"
								loading="lazy"
								className="my-4 h-auto max-w-full rounded-md"
							/>
						) : (
							<span>{alt}</span>
						),
				}}
			>
				{note.markdown}
			</Streamdown>
		</article>
	);
}
