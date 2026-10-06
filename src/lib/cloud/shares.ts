import i18n from "@/i18n";
import { cloudAiError } from "./ai";
import {
	MAX_SHARE_BYTES,
	type ShareFormat,
	type ShareInfo,
	type ShareSettings,
} from "./share-protocol";
import { cloudFetch } from "./sync";

export const shareUrl = (id: string) => `${location.origin}/share/${id}`;
export function shareError(error: unknown): string {
	const code = error instanceof Error ? error.message : "";
	return i18n.exists(`editor:share.errors.${code}`)
		? i18n.t(`editor:share.errors.${code}`, {
				defaultValue: cloudAiError(error),
			})
		: i18n.exists(`cloud:errors.${code}`)
			? cloudAiError(error)
			: i18n.t("editor:share.errors.requestFailed");
}
export async function listShares(
	sourcePath?: string,
	signal?: AbortSignal,
): Promise<ShareInfo[]> {
	if (!navigator.onLine) throw new Error("offline");
	return (
		await cloudFetch(
			`/api/shares${sourcePath ? `?path=${encodeURIComponent(sourcePath)}` : ""}`,
			{ signal },
		)
	).json();
}
export async function createShare(
	input: ShareSettings & {
		sourcePath: string;
		title: string;
		format: ShareFormat;
		snapshot?: boolean;
		blob: Blob;
	},
): Promise<ShareInfo> {
	if (!navigator.onLine) throw new Error("offline");
	if (input.blob.size > MAX_SHARE_BYTES) throw new Error("shareTooLarge");
	const id = crypto.randomUUID().replaceAll("-", "");
	const { blob, ...metadata } = input;
	const form = new FormData();
	form.set("metadata", JSON.stringify(metadata));
	form.set("file", blob, `snapshot.${input.format}`);
	try {
		return await (
			await cloudFetch(`/api/shares/${id}`, { method: "PUT", body: form })
		).json();
	} catch (error) {
		// Recover a lost acknowledgement without publishing another copy.
		const existing = await listShares(input.sourcePath)
			.then((rows) => rows.find((row) => row.id === id))
			.catch(() => undefined);
		if (existing) return existing;
		throw error;
	}
}
export async function revokeShare(id: string): Promise<void> {
	if (!navigator.onLine) throw new Error("offline");
	await cloudFetch(`/api/shares/${id}`, { method: "DELETE" });
}
