import type {
	LayoutProviderConfig,
	LayoutProviderId,
} from "@/lib/pdf/layout/settings";
import { loadSettings } from "@/lib/settings";
import { cloudLock } from "./db";
import { readLocalFile, writeLocalFile } from "./files";
import {
	type ParserResult,
	parseMineruResult,
	parsePaddleResult,
} from "./parser-result";
import { CloudHttpError, cloudFetch } from "./sync";

function config(provider: LayoutProviderId) {
	return { ...loadSettings().layout.providerConfigs[provider], provider };
}
export async function parserProbe(
	provider: LayoutProviderId,
	imageBase64: string,
	apiKey?: string,
	override?: Partial<LayoutProviderConfig>,
	signal?: AbortSignal,
): Promise<{ jobId: string }> {
	return (
		await cloudFetch("/api/parser/probe", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				...config(provider),
				...override,
				imageBase64,
				...(apiKey ? { apiKey } : {}),
			}),
			signal,
		})
	).json();
}
export async function parserOcr(
	provider: "agentero" | "openaiCompatible",
	imageBase64: string,
	mimeType: string,
	signal?: AbortSignal,
): Promise<string> {
	const result = (await (
		await cloudFetch("/api/parser/ocr", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...config(provider), imageBase64, mimeType }),
			signal,
		})
	).json()) as { text: string };
	return result.text;
}
export function parserPause(ms: number, signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const stop = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", stop);
			reject(signal?.reason ?? new Error("cancelled"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", stop);
			resolve();
		}, ms);
		signal?.addEventListener("abort", stop, { once: true });
	});
}
async function safeRead(path: string): Promise<Blob | null> {
	try {
		return await readLocalFile(path);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("File not found:"))
			return null;
		throw error;
	}
}
async function getWithRetry(
	path: string,
	signal?: AbortSignal,
): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		signal?.throwIfAborted();
		try {
			return await cloudFetch(path, { signal });
		} catch (error) {
			if (
				signal?.aborted ||
				attempt >= 5 ||
				(error instanceof CloudHttpError &&
					error.status < 500 &&
					error.status !== 429)
			)
				throw error;
			await parserPause(Math.min(30000, 1000 * 2 ** attempt), signal);
		}
	}
}
/** Persist the request identity before upload. Reload/reconnect resumes the same provider job. */
export async function runParserJob(
	path: string,
	provider: "paddle" | "mineru",
	mode: "layout" | "body",
	options: {
		signal?: AbortSignal;
		force?: boolean;
		onProgress?: (page: number, total: number) => void;
	} = {},
): Promise<ParserResult> {
	const cfg = config(provider);
	const blob = await readLocalFile(path);
	if (blob.size > 16 * 1024 * 1024) throw new Error("tooLarge");
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const hash = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
		(v) => v.toString(16).padStart(2, "0"),
	).join("");
	const key = Array.from(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(JSON.stringify({ hash, cfg, mode })),
			),
		),
		(v) => v.toString(16).padStart(2, "0"),
	).join("");
	return cloudLock(`parser-${key}`, async () => {
		const marker = `.agentero/parser/jobs/${key}.json`;
		const old = options.force ? null : await safeRead(marker);
		const id = old
			? (JSON.parse(await old.text()) as { id: string }).id
			: crypto.randomUUID();
		const cache = `.agentero/parser/results/${id}.${provider === "paddle" ? "json" : "zip"}`;
		const cached = await safeRead(cache);
		const parse = async (result: Blob) =>
			provider === "paddle"
				? parsePaddleResult(JSON.parse(await result.text()))
				: parseMineruResult(new Uint8Array(await result.arrayBuffer()));
		if (cached) return parse(cached);
		if (!navigator.onLine) throw new Error("offline");
		options.signal?.throwIfAborted();
		if (!old)
			await writeLocalFile(
				marker,
				new Blob([JSON.stringify({ id })], { type: "application/json" }),
			);
		let job: { state: string } | undefined;
		if (old) {
			try {
				job = await (
					await getWithRetry(`/api/parser/jobs/${id}`, options.signal)
				).json();
			} catch (error) {
				if (!(error instanceof CloudHttpError && error.status === 404))
					throw error;
			}
		}
		if (!job) {
			let binary = "";
			for (let offset = 0; offset < bytes.length; offset += 32768)
				binary += String.fromCharCode(
					...bytes.subarray(offset, offset + 32768),
				);
			const body = JSON.stringify({
				...cfg,
				id,
				mode,
				fileName: path.split("/").at(-1),
				pdfBase64: btoa(binary),
			});
			// No automatic POST retry: resolve an uncertain response by reading the persisted job.
			try {
				job = await (
					await cloudFetch("/api/parser/jobs", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body,
						signal: options.signal,
					})
				).json();
			} catch (error) {
				if (options.signal?.aborted) throw error;
				try {
					job = await (
						await getWithRetry(`/api/parser/jobs/${id}`, options.signal)
					).json();
				} catch {
					throw error;
				}
			}
		}
		const started = Date.now();
		while (job?.state !== "ready" && job?.state !== "done") {
			if (job?.state === "uncertain") throw new Error("parserUncertain");
			if (job?.state === "failed") throw new Error("parserFailed");
			if (Date.now() - started > 15 * 60 * 1000)
				throw new Error("parserPending");
			options.onProgress?.(0, 0);
			await parserPause(5000, options.signal);
			job = await (
				await getWithRetry(`/api/parser/jobs/${id}`, options.signal)
			).json();
		}
		const response = await getWithRetry(
			`/api/parser/jobs/${id}/result`,
			options.signal,
		);
		const result = await response.blob();
		const parsed = await parse(result);
		await writeLocalFile(cache, result);
		return parsed;
	});
}
