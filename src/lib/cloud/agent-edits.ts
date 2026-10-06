import { z } from "zod";
import { cloudLock, localTransaction } from "./db";
import {
	cloudRelative,
	editedFile,
	filesChanged,
	readLocalFile,
} from "./files";

const editSchema = z.object({
	path: z.string(),
	before: z.string().nullable(),
	after: z.string(),
	status: z.enum(["pending", "kept", "reverted"]),
});
export type AgentEdit = z.infer<typeof editSchema>;
const editPath = (id: string) => {
	if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("invalidPath");
	return `.agentero/agent-edits/${id}.json`;
};
const notePath = (path: string) => {
	const rel = cloudRelative(path);
	if (
		!/\.(md|txt|tex|bib|excalidraw)$/i.test(rel) ||
		rel.startsWith(".") ||
		rel.startsWith("Conflicts/")
	)
		throw new Error("invalidPath");
	return rel;
};
export async function assertAgentDocumentClean(path: string) {
	const { workspaceStore } = await import("@/lib/workspace/store");
	const rel = cloudRelative(path);
	for (const tab of workspaceStore.getState().tabs) {
		if (
			((tab.markdownDirty || tab.textDirty || tab.excalidrawDirty) &&
				cloudRelative(tab.path) === rel) ||
			(tab.notesDirty && tab.notesPath && cloudRelative(tab.notesPath) === rel)
		)
			throw new Error("localConflict");
	}
}
async function refreshEditor(path: string) {
	try {
		const { applyDiskChange } = await import("@/lib/workspace/actions");
		await applyDiskChange(`/cloud/${path}`);
	} catch {
		// The durable transaction succeeded. Do not report a failed write or retry it.
		const { notifyError } = await import("@/lib/core/notify");
		const { default: i18n } = await import("@/i18n");
		notifyError(i18n.t("agent:web.editorRefreshFailed"));
	}
}
/** Note and recovery record commit atomically and enter the normal sync outbox. */
export async function writeAgentNote(
	path: string,
	content: string,
	expectedText: string | null,
) {
	const rel = notePath(path);
	const id = crypto.randomUUID();
	const journal = editPath(id);
	await cloudLock("files", async () => {
		const old = await localTransaction((files) => files.get(rel), false);
		const text = old && !old.deleted ? await old.data?.text() : null;
		if (text !== expectedText) throw new Error("localConflict");
		await assertAgentDocumentClean(rel);
		const edit: AgentEdit = {
			path: rel,
			before: expectedText,
			after: content,
			status: "pending",
		};
		await localTransaction((files) => {
			for (
				let parent = rel.slice(0, rel.lastIndexOf("/"));
				rel.includes("/") && parent;
				parent = parent.includes("/")
					? parent.slice(0, parent.lastIndexOf("/"))
					: ""
			) {
				const file = files.get(parent);
				if (file && !file.deleted && file.mime !== "inode/directory")
					throw new Error("pathExists");
			}
			files.set(
				rel,
				editedFile(
					rel,
					new Blob([content], { type: "text/plain" }),
					files.get(rel),
				),
			);
			files.set(
				journal,
				editedFile(
					journal,
					new Blob([JSON.stringify(edit)], { type: "application/json" }),
				),
			);
		});
	});
	filesChanged([rel, journal]);
	await refreshEditor(rel);
	return { path: rel, saved: true as const, editId: id };
}
export async function readAgentEdit(id: string): Promise<AgentEdit> {
	return editSchema.parse(
		JSON.parse(await (await readLocalFile(editPath(id))).text()),
	);
}
export async function resolveAgentEdit(
	id: string,
	action: "kept" | "reverted",
) {
	const journal = editPath(id);
	let changedPath: string | undefined;
	await cloudLock("files", async () => {
		const edit = await readAgentEdit(id);
		if (edit.status !== "pending") return;
		const rel = notePath(edit.path);
		if (action === "reverted") {
			const old = await localTransaction((files) => files.get(rel), false);
			if (!old || old.deleted || (await old.data?.text()) !== edit.after)
				throw new Error("localConflict");
			await assertAgentDocumentClean(rel);
			changedPath = rel;
		}
		await localTransaction((files) => {
			if (action === "reverted") {
				files.set(
					rel,
					editedFile(
						rel,
						edit.before === null
							? null
							: new Blob([edit.before], { type: "text/plain" }),
						files.get(rel),
					),
				);
			}
			edit.status = action;
			files.set(
				journal,
				editedFile(
					journal,
					new Blob([JSON.stringify(edit)], { type: "application/json" }),
					files.get(journal),
				),
			);
		});
	});
	filesChanged([journal, ...(changedPath ? [changedPath] : [])]);
	if (changedPath) await refreshEditor(changedPath);
}
