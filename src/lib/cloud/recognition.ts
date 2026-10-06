import { z } from "zod";
import i18n from "@/i18n";
import { isBackgroundTaskCancelledError } from "@/lib/core/background-tasks";
import { notifyError } from "@/lib/core/notify";
import { runLocalActivity } from "@/lib/core/tasks";
import { loadSettings, subscribeSettings } from "@/lib/settings";
import { cloudAiError } from "./ai";
import { type CloudPaper, updateCloudPaper } from "./catalog";
import { cloudLock } from "./db";
import {
	listLocalFiles,
	readLocalFile,
	subscribeCloudFiles,
	writeLocalFile,
} from "./files";
import { type RecognitionHit, recognitionHit } from "./recognition-protocol";
import { lookupCloudPaper } from "./research";
import { cloudFetch } from "./sync";

const prefix = ".agentero/recognition/";
const jobSchema = z.object({
	path: z.string().startsWith("papers/"),
	paperId: z.string(),
	pdfHash: z.string().regex(/^[a-f0-9]{64}$/),
	state: z.enum(["pending", "done", "failed", "cancelled", "skipped"]),
	attempts: z.number().int().min(0).max(1000),
	nextAttempt: z.number().finite(),
	error: z.string().max(200).optional(),
	hit: recognitionHit.optional(),
});
type Job = z.infer<typeof jobSchema>;
async function digest(blob: Blob) {
	return Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
		),
		(v) => v.toString(16).padStart(2, "0"),
	).join("");
}
export async function enqueuePdfRecognition(
	paper: CloudPaper,
	blob: Blob,
): Promise<void> {
	const job: Job = {
		path: paper.path,
		paperId: paper.id,
		pdfHash: await digest(blob),
		state: "pending",
		attempts: 0,
		nextAttempt: 0,
	};
	await writeLocalFile(
		`${prefix}${crypto.randomUUID()}.json`,
		new Blob([JSON.stringify(job)], { type: "application/json" }),
	);
}
export async function listRecognitionJobs() {
	const result: Array<{ path: string; localId: string; job: Job }> = [];
	for (const file of await listLocalFiles()) {
		if (
			file.deleted ||
			!file.data ||
			!file.path.startsWith(prefix) ||
			!/^\w[\w-]*\.json$/.test(file.path.slice(prefix.length))
		)
			continue;
		try {
			const job = jobSchema.parse(JSON.parse(await file.data.text()));
			result.push({ path: file.path, localId: file.localId, job });
		} catch {
			/* A sync conflict or malformed imported job never executes. */
		}
	}
	return result;
}
export async function retryRecognitionJobs(): Promise<void> {
	await cloudLock("recognition", async () => {
		for (const row of await listRecognitionJobs()) {
			if (row.job.state !== "failed" && row.job.state !== "cancelled") continue;
			await writeLocalFile(
				row.path,
				new Blob([
					JSON.stringify({
						...row.job,
						state: "pending",
						attempts: 0,
						nextAttempt: 0,
						error: undefined,
					}),
				]),
				{ expectedLocalId: row.localId },
			);
		}
	});
}
export function recognitionPatch(hit: RecognitionHit) {
	return {
		...(hit.title?.trim() ? { title: hit.title.trim() } : {}),
		...(hit.authors.length
			? {
					authors: hit.authors
						.map(
							(a) =>
								a.name?.trim() ||
								[a.firstName, a.lastName].filter(Boolean).join(" ").trim(),
						)
						.filter(Boolean),
				}
			: {}),
		...(hit.doi ? { doi: hit.doi } : {}),
		...(hit.arxiv ? { arxivId: hit.arxiv } : {}),
		...(hit.year && /^\d{4}$/.test(hit.year) ? { date: hit.year } : {}),
		...(hit.container ? { publication: hit.container } : {}),
		...(hit.publisher ? { publisher: hit.publisher } : {}),
		...(hit.volume ? { volume: hit.volume } : {}),
		...(hit.issue ? { issue: hit.issue } : {}),
		...(hit.pages ? { pages: hit.pages } : {}),
	};
}
/** Guard every automatic application against human edits and replaced PDFs. */
export async function processRecognitionQueue(): Promise<void> {
	const config = loadSettings().recognizer;
	if (!navigator.onLine || config.enabled === false || !config.baseUrl.trim())
		return;
	await cloudLock("recognition", async () => {
		for (const row of await listRecognitionJobs()) {
			const job = row.job;
			if (job.state !== "pending" || job.nextAttempt > Date.now()) continue;
			if (!navigator.onLine || loadSettings().recognizer.enabled === false)
				break;
			// Job files can arrive before their paper during per-file cloud sync.
			// Wait instead of permanently skipping a valid cross-device import.
			const available = await listLocalFiles();
			if (
				!available.some(
					(f) => !f.deleted && f.path === `${job.path}/.paper.json`,
				) ||
				!available.some((f) => !f.deleted && f.path === `${job.path}/paper.pdf`)
			)
				continue;
			const next = { ...job };
			let completionCommitted = false;
			try {
				await runLocalActivity(
					{
						kind: "pdfRecognition",
						title: i18n.t("cloud:recognizer.task"),
						detail: job.path,
					},
					async ({ signal }) => {
						const snapshot = await listLocalFiles();
						const meta = snapshot.find(
							(f) => f.path === `${job.path}/.paper.json` && !f.deleted,
						);
						const pdf = snapshot.find(
							(f) => f.path === `${job.path}/paper.pdf` && !f.deleted,
						);
						if (!meta?.data || !pdf) {
							next.nextAttempt = Date.now() + 30000;
							return;
						}
						const paper = JSON.parse(await meta.data.text()) as CloudPaper;
						if (paper.id !== job.paperId || paper.meta_source === "manual") {
							next.state = "skipped";
							return;
						}
						const blob = await readLocalFile(pdf.path);
						if ((await digest(blob)) !== job.pdfHash) {
							next.state = "skipped";
							return;
						}
						signal.throwIfAborted();
						let hit = job.hit;
						if (!hit) {
							const { extractRecognitionPayload } = await import(
								"./recognition-extract"
							);
							const payload = await extractRecognitionPayload(
								blob,
								`${paper.title}.pdf`,
								signal,
							);
							hit = recognitionHit.parse(
								await (
									await cloudFetch("/api/recognize", {
										method: "POST",
										headers: { "content-type": "application/json" },
										body: JSON.stringify({
											...loadSettings().recognizer,
											operation: "recognize",
											payload,
										}),
										signal,
									})
								).json(),
							);
							next.hit = hit;
						}
						let patch = recognitionPatch(hit);
						const identifier = hit.arxiv || hit.doi || hit.isbn;
						if (identifier) {
							const resolved = await lookupCloudPaper(identifier, signal);
							if (!resolved.exact || resolved.papers.length !== 1)
								throw new Error("paperNotFound");
							const record = resolved.papers[0];
							patch = {
								...patch,
								...(record.title ? { title: record.title } : {}),
								...(record.authors?.length ? { authors: record.authors } : {}),
								...(record.year ? { date: String(record.year) } : {}),
								...(record.doi ? { doi: record.doi } : {}),
								...(record.arxiv_id ? { arxivId: record.arxiv_id } : {}),
							};
						}
						// PDF guards are checked in the same transaction as notes and metadata.
						await updateCloudPaper(job.path, patch, {
							expectedLocalId: meta.localId,
							expectedFiles: { [pdf.path]: pdf.localId },
							metaSource: "recognizer",
							signal,
						});
						if (identifier) {
							const { dirtyVaultPaths, closeTab, openPaper } = await import(
								"@/lib/workspace/actions"
							);
							const { organizeRecognizedPaper } = await import(
								"./recognition-organize"
							);
							const organized = await organizeRecognizedPaper(
								job.path,
								dirtyVaultPaths("/cloud"),
								signal,
								{
									path: row.path,
									localId: row.localId,
									before: await (await readLocalFile(row.path)).text(),
									content: (destination) =>
										JSON.stringify({
											...next,
											path: destination,
											state: "done",
										}),
								},
							);
							completionCommitted = Boolean(organized.move);
							next.path = organized.path;
							if (organized.move) {
								const { getTabs } = await import("@/lib/workspace/store");
								const oldPaperTab = organized.archived
									? getTabs().find(
											(tab) => tab.path === `/cloud/${organized.from}`,
										)
									: undefined;
								if (oldPaperTab) closeTab(oldPaperTab.id, { remember: false });
								const { syncMovedPaths } = await import("@/lib/wiki/actions");
								syncMovedPaths(
									"/cloud",
									`/cloud/${organized.from}`,
									`/cloud/${organized.path}`,
									organized.from,
									organized.path,
									organized.move,
								);
								if (oldPaperTab && organized.primaryPath)
									openPaper(`/cloud/${organized.primaryPath}`);
							}
						}
						next.state = "done";
					},
				);
			} catch (error) {
				const cancelled = isBackgroundTaskCancelledError(error);
				const code =
					error instanceof Error ? error.message : "providerUnavailable";
				next.attempts++;
				next.error = /^[a-zA-Z]{1,80}$/.test(code)
					? code
					: "providerUnavailable";
				next.state = cancelled
					? "cancelled"
					: next.attempts >= 3 ||
							[
								"recognitionNoText",
								"metadataChanged",
								"invalidProviderResponse",
							].includes(code)
						? "failed"
						: "pending";
				next.nextAttempt = Date.now() + 30000 * 2 ** (next.attempts - 1);
				if (!cancelled) notifyError(cloudAiError(new Error(next.error)));
			}
			if (completionCommitted) continue;
			await writeLocalFile(
				row.path,
				new Blob([JSON.stringify(next)], { type: "application/json" }),
				{ expectedLocalId: row.localId },
			);
		}
	});
}
export function startRecognitionQueue(): () => void {
	let stopped = false,
		running = false;
	const run = () => {
		if (stopped || running) return;
		running = true;
		void processRecognitionQueue()
			.catch((e) => notifyError(cloudAiError(e)))
			.finally(() => {
				running = false;
			});
	};
	const unsubscribe = subscribeCloudFiles((paths) => {
		if (paths.some((p) => p.startsWith(prefix))) run();
	});
	const unsubscribeSettings = subscribeSettings(run);
	const timer = window.setInterval(run, 30000);
	window.addEventListener("online", run);
	run();
	return () => {
		stopped = true;
		unsubscribe();
		unsubscribeSettings();
		window.clearInterval(timer);
		window.removeEventListener("online", run);
	};
}
