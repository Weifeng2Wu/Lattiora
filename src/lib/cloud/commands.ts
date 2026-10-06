/** Compatibility boundary for the original typed React data APIs.
 * Only implemented operations are routed here; native commands fail explicitly. */
import i18n from "@/i18n";
import type { commands } from "@/lib/core/bindings";
import { exportBibliography, importBibliography } from "./bibliography";
import {
	getCloudPaper,
	importCloudPdfs,
	listCloudPapers,
	openCloudPaper,
	rescanCloudPapers,
	setCloudPaperTags,
	updateCloudPaper,
} from "./catalog";
import {
	addFeed,
	feedItems,
	listFeeds,
	markFeedImported,
	pinFeed,
	refreshFeeds,
	removeFeed,
	renameFeed,
	resolveFeedBody,
} from "./feeds";
import { exists, readTextFile, writeTextFile } from "./fs";
import { lookupCloudPaper } from "./research";
import { discardCloudSkillDiscovery, installCloudSkills } from "./skill-import";
import {
	listCloudTrash,
	purgeCloudTrash,
	restoreCloudTrash,
	trashCloudPaths,
} from "./trash";
import {
	cloudBacklinks,
	cloudGraphRebuild,
	cloudSearch,
	cloudWikiSearch,
	moveCloudPath,
	readCloudEmbed,
	resolveCloudLink,
} from "./wiki";
import { renameCloudHeading } from "./wiki-heading";

type Args<K extends keyof typeof commands> = {
	args: Parameters<(typeof commands)[K]>[0];
};
const handlers = {
	paper_reading_activity_batch: ({ args }: Args<"paperReadingActivityBatch">) =>
		import("./reading-activity").then((m) =>
			m.readCloudReadingActivity(args.paths),
		),
	paper_refs_list: ({ args }: Args<"paperRefsList">) =>
		import("./references").then((m) => m.readCloudReferences(args.path)),
	paper_refs_parse: ({ args }: Args<"paperRefsParse">) =>
		import("./references").then((m) =>
			m.parseCloudReferences(args.path, args.force),
		),
	recommend_arxiv: async ({ args }: Args<"recommendArxiv">) =>
		(await import("./recommend")).recommendCloudArxiv(args),
	recommend_arxiv_last: async () =>
		(await import("./recommend")).lastCloudRecommendations(),
	wiki_rename_heading: ({ args }: Args<"wikiRenameHeading">) =>
		renameCloudHeading(args),
	skill_install: ({ args }: Args<"skillInstall">) =>
		installCloudSkills(args.discoveryId, args.selectedNames ?? []),
	skill_discard: ({ discoveryId }: { discoveryId: string }) => {
		discardCloudSkillDiscovery(discoveryId);
		return null;
	},
	feeds_list: () => listFeeds(),
	feeds_add: ({ args }: Args<"feedsAdd">) => addFeed(args.url, args.title),
	feeds_remove: ({ args }: Args<"feedsRemove">) => removeFeed(args.id),
	feeds_rename: ({ args }: Args<"feedsRename">) =>
		renameFeed(args.id, args.title),
	feeds_set_pinned: ({ args }: Args<"feedsSetPinned">) =>
		pinFeed(args.id, args.pinned),
	feeds_refresh: ({ args }: Args<"feedsRefresh">) =>
		refreshFeeds(args.id, args.staleOnly),
	feeds_items: ({ args }: Args<"feedsItems">) => feedItems(args),
	feeds_mark_imported: ({ args }: Args<"feedsMarkImported">) =>
		markFeedImported(args.id),
	feeds_resolve_body: ({ args }: Args<"feedsResolveBody">) =>
		resolveFeedBody(args.id),
	paper_resolve_identifier: async ({
		args,
	}: Args<"paperResolveIdentifier">) => {
		const result = await lookupCloudPaper(args.text);
		if (!result.exact || !result.papers[0]) throw new Error("paperNotFound");
		return result.papers[0];
	},
	paper_list: () => listCloudPapers(),
	paper_get: ({ args }: Args<"paperGet">) => getCloudPaper(args.path, args.id),
	paper_open_bundle: ({ args }: Args<"paperOpenBundle">) =>
		openCloudPaper(args.path),
	paper_rescan: async () => ({ ...(await rescanCloudPapers()), errors: [] }),
	paper_import_local_pdf: ({ args }: Args<"paperImportLocalPdf">) =>
		importCloudPdfs(args),
	paper_update_meta: ({ args }: Args<"paperUpdateMeta">) =>
		updateCloudPaper(args.path, args.patch),
	paper_set_tags: ({ args }: Args<"paperSetTags">) =>
		setCloudPaperTags(args.path, args.tags),
	paper_set_is_read: async ({ args }: Args<"paperSetIsRead">) =>
		updateCloudPaper(args.path, { is_read: args.isRead }, { metaSource: null }),
	paper_move: async ({ args }: Args<"paperMove">) => {
		const to = `${args.destParentRel}/${args.fromRel.split("/").at(-1)}`;
		const result = await moveCloudPath(args.fromRel, to, args.dirtyPaths ?? []);
		return { ...result, fromRel: args.fromRel, toRel: to };
	},
	paper_export: ({ args }: Args<"paperExport">) =>
		exportBibliography(args.format ?? undefined),
	paper_import: ({ args }: Args<"paperImport">) =>
		importBibliography(args.content, args.parentDir ?? undefined),
	paper_page_counts: async () =>
		(await exists(".agentero/page-counts.json"))
			? JSON.parse(await readTextFile(".agentero/page-counts.json"))
			: {},
	paper_set_page_counts: async ({ args }: Args<"paperSetPageCounts">) => {
		const previous = await handlers.paper_page_counts();
		await writeTextFile(
			".agentero/page-counts.json",
			JSON.stringify({ ...previous, ...args.counts }),
		);
		return null;
	},
	path_trash: ({ args }: Args<"pathTrash">) => trashCloudPaths(args.rels),
	path_list_trash: () => listCloudTrash(),
	path_restore_item: ({ args }: Args<"pathRestoreItem">) =>
		restoreCloudTrash(args.batchId, args.stored),
	path_purge_item: ({ args }: Args<"pathPurgeItem">) =>
		purgeCloudTrash(args.batchId, args.stored),
	path_purge_trash: () => purgeCloudTrash(),
	wiki_move: ({ args }: Args<"wikiMove">) =>
		moveCloudPath(args.fromRel, args.toRel, args.dirtyPaths ?? []),
	wiki_resolve: async ({
		sourcePath,
		linkText,
		syntax,
	}: {
		sourcePath: string;
		linkText: string;
		syntax?: "wikilink" | "markdown";
	}) => ({ link: await resolveCloudLink(sourcePath, linkText, syntax) }),
	wiki_embed_read: ({
		sourcePath,
		linkText,
	}: {
		sourcePath: string;
		linkText: string;
	}) => readCloudEmbed(sourcePath, linkText),
	wiki_search: ({
		query,
		path,
		kind,
	}: {
		query: string;
		path?: string;
		kind?: string;
	}) => cloudWikiSearch(query, path, kind),
	graph_get_backlinks: ({ path }: { path: string }) => cloudBacklinks(path),
	graph_rebuild: () => cloudGraphRebuild(),
	wiki_cache_rebuild: () => cloudGraphRebuild(),
	vault_search: ({ query, limit }: { query: string; limit?: number | null }) =>
		cloudSearch(query, limit ?? undefined),
	search_fts: ({ args }: { args: { query: string; limit?: number } }) =>
		cloudSearch(args.query, args.limit),
};

export async function invoke<T>(
	command: string,
	args: unknown = {},
): Promise<T> {
	const handler = handlers[command as keyof typeof handlers] as unknown as
		| ((args: unknown) => Promise<unknown>)
		| undefined;
	if (!handler)
		throw new Error(i18n.t("cloud:errors.unsupported", { command }));
	return { ok: true, data: await handler(args) } as T;
}
