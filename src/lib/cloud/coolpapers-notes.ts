import i18n from "@/i18n";
import type { PaperMetadata } from "@/lib/paper/types";
import { coolPaperUrl } from "./coolpapers";
import { cloudLock, localTransaction } from "./db";
import {
	cloudRelative,
	editedFile,
	filesChanged,
	listLocalFiles,
} from "./files";
import { loadHtmlPage } from "./html-reader";

type Reference = { branch: "arxiv" | "venue"; id: string };
export function coolPaperReference(
	meta: Pick<PaperMetadata, "id" | "source_url" | "arxiv_id">,
): Reference | null {
	try {
		const url = new URL(meta.source_url || "");
		if (
			["papers.cool", "www.papers.cool"].includes(url.hostname) &&
			/^https?:$/.test(url.protocol)
		) {
			const [branch, part] = url.pathname.split("/").filter(Boolean);
			const id =
				part === "kimi"
					? url.searchParams.get("paper")
					: part && decodeURIComponent(part);
			if ((branch === "arxiv" || branch === "venue") && id && id !== "search")
				return { branch, id };
		}
	} catch {
		/* Try the catalog identifiers. */
	}
	if (meta.id && /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$/.test(meta.id))
		return { branch: "venue", id: meta.id };
	const arxiv = meta.arxiv_id?.trim().replace(/v\d+$/i, "");
	if (arxiv) return { branch: "arxiv", id: arxiv };
	return null;
}
const titleKey = (title: string) =>
	title.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
export function resolveCoolTitle(html: string, title: string): string | null {
	const doc = new DOMParser().parseFromString(html, "text/html"),
		want = titleKey(title);
	if (!want) return null;
	const rows = Array.from(doc.querySelectorAll('a[id^="title-"]'))
		.map((a) => ({ id: a.id.slice(6), title: titleKey(a.textContent || "") }))
		.filter((row) => row.id && row.title);
	const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
	const exact = unique.filter((row) => row.title === want);
	if (exact.length === 1) return exact[0].id;
	if (exact.length > 1) return null;
	const prefixes = unique.filter((row) => {
		const [short, long] =
			row.title.length < want.length ? [row.title, want] : [want, row.title];
		return [...short].length >= 24 && long.startsWith(short);
	});
	return prefixes.length === 1 ? prefixes[0].id : null;
}
/** Original FAQ heading hierarchy and Markdown/math preservation; drop the Kimi website CTA. */
export function coolFaqMarkdown(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	for (const el of doc.querySelectorAll("script,style,iframe,object"))
		el.remove();
	const blocks: string[] = [];
	for (const question of doc.querySelectorAll(".faq-q")) {
		const text = question.textContent?.trim() || "";
		const answer = question.nextElementSibling;
		if (
			!text ||
			/想要进一步了解|进一步了解论文/.test(text) ||
			!answer?.classList.contains("faq-a")
		)
			continue;
		for (const br of answer.querySelectorAll("br")) br.replaceWith("\n");
		const body = answer.textContent?.trim();
		if (body) blocks.push(`## ${text}\n\n${body}`);
	}
	return blocks
		.join("\n\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
export async function fetchCoolAnalysis(
	meta: PaperMetadata,
	signal?: AbortSignal,
): Promise<{ url: string; markdown: string } | null> {
	return cloudLock("coolpapers-analysis", async () => {
		let reference = coolPaperReference(meta);
		if (!reference && meta.title) {
			const query = meta.title
				.split(/[^\p{L}\p{N}]+/u)
				.filter(Boolean)
				.join(" ");
			let failure: unknown;
			for (const branch of ["arxiv", "venue"] as const) {
				signal?.throwIfAborted();
				try {
					const source = await loadHtmlPage(
						`https://papers.cool/${branch}/search?query=${encodeURIComponent(query)}`,
						signal,
					);
					const id = resolveCoolTitle(source.html, meta.title);
					if (id) {
						reference = { branch, id };
						break;
					}
				} catch (error) {
					if (signal?.aborted) throw error;
					failure = error;
				}
			}
			if (!reference && failure) throw failure;
		}
		if (!reference) return null;
		const { branch, id } = reference;
		const result = await loadHtmlPage(
			`https://papers.cool/${branch}/kimi?paper=${encodeURIComponent(id)}`,
			signal,
			{
				preferCache: true,
				allowPlain: true,
				analysis: true,
				acceptCache: (page) => Boolean(coolFaqMarkdown(page.html)),
			},
		);
		const markdown = coolFaqMarkdown(result.html);
		return markdown ? { url: coolPaperUrl(branch, id), markdown } : null;
	});
}
export async function appendCoolAnalysis(
	paperPath: string,
	analysis: { url: string; markdown: string },
	options: { signal?: AbortSignal; guard?: () => void } = {},
): Promise<boolean> {
	const path = `${cloudRelative(paperPath)}/NOTES.md`;
	const appended = await cloudLock("files", async () => {
		const old = (await listLocalFiles()).find(
			(file) => file.path === path && !file.deleted,
		);
		if (!old?.data) throw new Error("paperNotFound");
		const before = await old.data.text();
		if (before.includes(analysis.markdown)) return false;
		const block = `**${i18n.t("cloud:plaza.analysis")}**\n\n> ${analysis.url}\n\n${analysis.markdown}`;
		await localTransaction((files) => {
			options.signal?.throwIfAborted();
			options.guard?.();
			if (files.get(path)?.localId !== old.localId)
				throw new Error("localConflict");
			files.set(
				path,
				editedFile(
					path,
					new Blob([`${before.trimEnd()}\n\n${block}\n`], {
						type: "text/markdown",
					}),
					old,
				),
			);
		});
		return true;
	});
	if (appended) filesChanged([path]);
	return appended;
}
