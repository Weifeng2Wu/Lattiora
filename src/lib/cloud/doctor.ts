import i18n from "@/i18n";
import type {
	DoctorReport_Serialize,
	DoctorVaultState,
	PaperRecord_Serialize,
	WikilinkRepairPlan_Serialize,
} from "@/lib/core/bindings";
import { parsePdfVisualSessionTrace } from "@/lib/pdf/agent-trace/schema";
import {
	readNoteAliases,
	suggestShortAlias,
	withNoteAliases,
} from "@/lib/vault/note-template";
import { workspaceStore } from "@/lib/workspace/store";
import { cloudLock, localTransaction } from "./db";
import {
	cloudRelative,
	editedFile,
	filesChanged,
	listLocalFiles,
	readLocalFile,
} from "./files";
import {
	cloudDocumentLinks,
	cloudLinkOccurrences,
	resolveCloudLink,
	workspaceDocuments,
} from "./wiki";

const message = (code: string) =>
	i18n.t(`cloud:doctor.${code}`, { defaultValue: code });
export async function contentHash(text: string): Promise<string> {
	return [
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
		),
	]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
}
const statePath = ".agentero/doctor.json";
async function doctorState(): Promise<DoctorVaultState> {
	try {
		return JSON.parse(await (await readLocalFile(statePath)).text());
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("File not found:"))
			return { ignoredAliasPaths: [] };
		throw error;
	}
}
export async function checkCloudDoctor(): Promise<DoctorReport_Serialize> {
	const files = (await listLocalFiles()).filter((f) => !f.deleted);
	const report: DoctorReport_Serialize = {
		ok: true,
		vault: { ok: true, issues: [] },
		catalog: {
			ok: true,
			schemaVersion: 1,
			expectedSchemaVersion: 1,
			issues: [],
		},
		wikilinks: {
			checkedFiles: 0,
			counts: { resolved: 0, missing: 0, ambiguous: 0, invalidFragment: 0 },
			issues: [],
		},
		aliases: {
			ok: true,
			checkedPapers: 0,
			completePapers: 0,
			candidates: [],
			ignoredPaths: (await doctorState()).ignoredAliasPaths ?? [],
			issues: [],
		},
		visualMarks: { ok: true, checkedFiles: 0, candidates: [], issues: [] },
	};
	const papers: PaperRecord_Serialize[] = [];
	const ids = new Set<string>();
	for (const file of files) {
		if (!file.data && file.mime !== "inode/directory")
			report.vault.issues.push({
				code: "notCached",
				message: message("notCached"),
				path: file.path,
				severity: "error",
			});
		if (file.path.startsWith("papers/") && file.path.endsWith("/.paper.json")) {
			try {
				const paper = JSON.parse(
					await file.data!.text(),
				) as PaperRecord_Serialize;
				if (
					typeof paper.id !== "string" ||
					typeof paper.title !== "string" ||
					!Array.isArray(paper.authors) ||
					paper.path !== file.path.slice(0, -"/.paper.json".length)
				)
					throw new Error();
				if (ids.has(paper.id))
					report.catalog.issues.push({
						code: "duplicateId",
						message: message("duplicateId"),
						path: file.path,
						severity: "warning",
					});
				ids.add(paper.id);
				papers.push(paper);
			} catch {
				report.catalog.issues.push({
					code: "invalidMetadata",
					message: message("invalidMetadata"),
					path: file.path,
					severity: "error",
				});
			}
		}
		if (
			file.path.includes("/marks/") &&
			file.path.endsWith(".json") &&
			file.data
		) {
			report.visualMarks.checkedFiles++;
			try {
				const raw = JSON.parse(await file.data.text());
				if (raw.kind === "visual" || raw.kind === "agent-trace") {
					const trace = parsePdfVisualSessionTrace(raw);
					if (!trace) throw new Error();
					if (raw.kind === "agent-trace" || raw.version !== 2)
						report.visualMarks.candidates.push({
							path: file.path,
							markId: trace.id,
							reason: message("legacyMark"),
							fixable: true,
							selectedByDefault: true,
						});
				}
			} catch {
				report.visualMarks.issues.push({
					code: "invalidMark",
					message: message("invalidMark"),
					path: file.path,
					severity: "error",
				});
			}
		}
	}
	const docs = await workspaceDocuments();
	for (const doc of docs.filter((d) => /\.(md|mdx|markdown)$/i.test(d.path))) {
		report.wikilinks.checkedFiles++;
		for (const link of await cloudDocumentLinks(doc, docs)) {
			report.wikilinks.counts[link.status]++;
			if (link.status !== "resolved")
				report.wikilinks.issues.push({
					status: link.status,
					source: doc.path,
					line: link.occurrence.line,
					targetRaw: link.occurrence.targetRaw,
					syntax: link.occurrence.syntax,
					embed: link.occurrence.embed,
					targetPath: link.targetPath,
					candidates: link.candidates,
					context: link.occurrence.context,
				});
		}
	}
	for (const paper of papers) {
		const path = `${paper.path}/NOTES.md`;
		report.aliases.checkedPapers++;
		if (report.aliases.ignoredPaths.includes(path)) continue;
		const doc = docs.find((d) => d.path === path);
		if (!doc) {
			report.aliases.issues.push({
				code: "missingNotes",
				message: message("missingNotes"),
				path,
				severity: "warning",
			});
			continue;
		}
		const aliases = readNoteAliases(doc.content);
		const short = suggestShortAlias(paper.title, paper.authors, paper.year);
		if (aliases?.includes(paper.title) && (!short || aliases.includes(short))) {
			report.aliases.completePapers++;
			continue;
		}
		report.aliases.candidates.push({
			path,
			paperTitle: paper.title,
			currentAliases: aliases ?? [],
			titleAlias: paper.title,
			shortAlias: short,
			expectedHash: await contentHash(doc.content),
			fixable: aliases !== null,
			selectedByDefault: aliases !== null,
			reason: aliases === null ? message("invalidFrontmatter") : null,
		});
	}
	report.vault.ok = !report.vault.issues.length;
	report.catalog.ok = !report.catalog.issues.length;
	report.aliases.ok =
		!report.aliases.candidates.length && !report.aliases.issues.length;
	report.visualMarks.ok =
		!report.visualMarks.issues.length && !report.visualMarks.candidates.length;
	report.ok =
		report.vault.ok &&
		report.catalog.ok &&
		report.aliases.ok &&
		report.visualMarks.ok &&
		!report.wikilinks.issues.length;
	return report;
}
function assertClean(paths: string[]) {
	for (const tab of workspaceStore.getState().tabs) {
		if (
			(tab.markdownDirty || tab.textDirty || tab.excalidrawDirty) &&
			paths.includes(cloudRelative(tab.path))
		)
			throw new Error(message("dirtyDocument"));
		if (
			tab.notesDirty &&
			tab.notesPath &&
			paths.includes(cloudRelative(tab.notesPath))
		)
			throw new Error(message("dirtyDocument"));
	}
}
type Edit = {
	path: string;
	hash?: string;
	transform: (before: string) => string;
};
async function applyEdits(
	edits: Edit[],
	validate?: (
		prepared: { path: string; before: string; after: string }[],
	) => Promise<void>,
): Promise<{ updatedPaths: string[] }> {
	const paths = edits.map((e) => cloudRelative(e.path));
	if (new Set(paths).size !== paths.length) throw new Error("invalidRequest");
	await cloudLock("files", async () => {
		assertClean(paths);
		const prepared = await Promise.all(
			edits.map(async (edit, index) => {
				const path = paths[index];
				const before = await (await readLocalFile(path)).text();
				if (edit.hash && (await contentHash(before)) !== edit.hash)
					throw new Error(message("staleDocument"));
				return { path, before, after: edit.transform(before) };
			}),
		);
		await validate?.(prepared);
		assertClean(paths);
		await localTransaction((files) => {
			for (const { path, after } of prepared)
				files.set(
					path,
					editedFile(
						path,
						new Blob([after], {
							type: path.endsWith(".json")
								? "application/json"
								: "text/markdown",
						}),
						files.get(path),
					),
				);
		});
	});
	filesChanged(paths);
	return { updatedPaths: paths };
}
export function applyCloudAliases(
	changes: Array<{
		path: string;
		titleAlias: string;
		shortAlias: string;
		expectedHash: string;
	}>,
) {
	return applyEdits(
		changes.map((c) => ({
			path: c.path,
			hash: c.expectedHash,
			transform: (before) =>
				withNoteAliases(before, [
					c.titleAlias,
					c.shortAlias,
					...(readNoteAliases(before) ?? []),
				]),
		})),
	);
}
export async function ignoreCloudAliases(
	paths: string[],
	ignore: boolean,
): Promise<DoctorVaultState> {
	const next = await cloudLock("files", async () => {
		const previous = await doctorState();
		const ignored = new Set(previous.ignoredAliasPaths);
		for (const path of paths) {
			if (ignore) ignored.add(cloudRelative(path));
			else ignored.delete(cloudRelative(path));
		}
		const next = { ignoredAliasPaths: [...ignored] };
		await localTransaction((files) =>
			files.set(
				statePath,
				editedFile(
					statePath,
					new Blob([JSON.stringify(next)], { type: "application/json" }),
					files.get(statePath),
				),
			),
		);
		return next;
	});
	filesChanged([statePath]);
	return next;
}
export function repairCloudVisualMarks(changes: Array<{ path: string }>) {
	return applyEdits(
		changes.map((c) => ({
			path: c.path,
			transform: (before) => {
				const raw = JSON.parse(before);
				const trace = parsePdfVisualSessionTrace(raw);
				if (!trace || (raw.kind !== "agent-trace" && raw.kind !== "visual"))
					throw new Error(message("invalidMark"));
				return JSON.stringify(
					{ ...trace, kind: "visual", version: 2 },
					null,
					2,
				);
			},
		})),
	);
}
export async function planCloudWikilinks(): Promise<WikilinkRepairPlan_Serialize> {
	const docs = await workspaceDocuments();
	const suggestions: WikilinkRepairPlan_Serialize["suggestions"] = [];
	for (const doc of docs.filter((d) => /\.(md|mdx|markdown)$/i.test(d.path))) {
		for (const occ of cloudLinkOccurrences(doc.content)) {
			const link = await resolveCloudLink(doc.path, occ.body, occ.syntax, docs);
			if (link.status === "resolved") continue;
			// Fragment repairs replace only the text after #, preserving path and alias.
			const fragment =
				!!link.targetPath &&
				!!link.occurrence.fragment &&
				occ.body.includes("#");
			const hashIndex = occ.body.indexOf("#");
			const fragmentEnd =
				occ.syntax === "wikilink" ? occ.body.indexOf("|", hashIndex) : -1;
			const start = fragment
				? occ.targetStart + hashIndex + 1
				: occ.targetStart;
			const end = fragment
				? occ.targetStart + (fragmentEnd < 0 ? occ.body.length : fragmentEnd)
				: occ.targetEnd;
			const before = doc.content.slice(0, start),
				expected = doc.content.slice(start, end);
			const normalized = expected.replaceAll("\\", "/");
			const checked = await resolveCloudLink(
				doc.path,
				normalized,
				occ.syntax,
				docs,
			);
			const automatic =
				!fragment && normalized !== expected && checked.status === "resolved";
			suggestions.push({
				id: crypto.randomUUID(),
				source: doc.path,
				line: occ.line,
				status: link.status,
				syntax: occ.syntax,
				embed: occ.embed,
				targetRaw: occ.body,
				suggestedReplacement: automatic ? normalized : expected,
				editKind: fragment ? "fragment" : "target",
				rangeStart: new TextEncoder().encode(before).length,
				rangeEnd: new TextEncoder().encode(doc.content.slice(0, end)).length,
				expected,
				expectedHash: await contentHash(doc.content),
				linePrefix: before.slice(before.lastIndexOf("\n") + 1),
				lineSuffix: doc.content.slice(end).split("\n")[0],
				layer: automatic ? "deterministic" : "manual",
				reason: message(automatic ? "normalizeLink" : "manualLink"),
				selectedByDefault: automatic,
				candidates: link.candidates,
				context: occ.context,
			});
		}
	}
	return { suggestions, residuals: [] };
}
export async function applyCloudWikilinks(
	changes: Array<{
		source: string;
		rangeStart: number;
		rangeEnd: number;
		expected: string;
		replacement: string;
		expectedHash: string;
	}>,
) {
	if (
		!changes.length ||
		changes.some((change) => change.replacement === change.expected)
	)
		throw new Error(message("invalidLinkRepair"));
	const groups = new Map<string, typeof changes>();
	for (const change of changes)
		groups.set(change.source, [...(groups.get(change.source) ?? []), change]);
	return applyEdits(
		[...groups].map(([path, edits]) => ({
			path,
			hash: edits[0].expectedHash,
			transform: (before) => {
				let bytes = new TextEncoder().encode(before);
				let last = bytes.length;
				for (const edit of edits.sort((a, b) => b.rangeStart - a.rangeStart)) {
					if (
						edit.expectedHash !== edits[0].expectedHash ||
						edit.rangeStart < 0 ||
						edit.rangeEnd > last ||
						edit.rangeEnd < edit.rangeStart ||
						new TextDecoder().decode(
							bytes.slice(edit.rangeStart, edit.rangeEnd),
						) !== edit.expected
					)
						throw new Error(message("staleDocument"));
					const replacement = new TextEncoder().encode(edit.replacement);
					const next = new Uint8Array(
						bytes.length +
							replacement.length -
							(edit.rangeEnd - edit.rangeStart),
					);
					next.set(bytes.slice(0, edit.rangeStart));
					next.set(replacement, edit.rangeStart);
					next.set(
						bytes.slice(edit.rangeEnd),
						edit.rangeStart + replacement.length,
					);
					bytes = next;
					last = edit.rangeStart;
				}
				return new TextDecoder().decode(bytes);
			},
		})),
		async (prepared) => {
			const docs = await workspaceDocuments();
			const after = new Map(prepared.map((doc) => [doc.path, doc.after]));
			const prospective = docs.map((doc) => ({
				...doc,
				content: after.get(doc.path) ?? doc.content,
			}));
			for (const doc of prepared) {
				const bytes = new TextEncoder().encode(doc.before);
				const occurrences = cloudLinkOccurrences(doc.before);
				for (const edit of changes.filter(
					(change) => cloudRelative(change.source) === doc.path,
				)) {
					const occurrence = occurrences.find((occ) => {
						const start = new TextEncoder().encode(
							doc.before.slice(0, occ.bodyStart),
						).length;
						const end = start + new TextEncoder().encode(occ.body).length;
						return start <= edit.rangeStart && edit.rangeEnd <= end;
					});
					if (!occurrence) throw new Error(message("invalidLinkRepair"));
					const start = new TextEncoder().encode(
						doc.before.slice(0, occurrence.bodyStart),
					).length;
					const end = start + new TextEncoder().encode(occurrence.body).length;
					const body =
						new TextDecoder().decode(bytes.slice(start, edit.rangeStart)) +
						edit.replacement +
						new TextDecoder().decode(bytes.slice(edit.rangeEnd, end));
					const wrapped =
						occurrence.syntax === "wikilink"
							? `[[${body}]]`
							: `[link](${body})`;
					const parsed = cloudLinkOccurrences(wrapped);
					if (
						parsed.length !== 1 ||
						parsed[0].body !== body ||
						(
							await resolveCloudLink(
								doc.path,
								body,
								occurrence.syntax,
								prospective,
							)
						).status !== "resolved"
					)
						throw new Error(message("invalidLinkRepair"));
				}
			}
		},
	);
}
