import type { LayoutModelStatus } from "@/lib/core/bindings";

export type { LayoutModelStatus };

export const LAYOUT_MODEL_CACHE = "embedpdf-ai-models";
export const LAYOUT_MODEL_BYTES = 65546435;
export const LAYOUT_MODEL_SHA256 =
	"e549a04370b88c3f26fe8a975d7f15d76cb15876b54588270c977426793445ad";
export function layoutModelLocalUrl(): string {
	return new URL("/api/layout-model", location.origin).href;
}
export async function getLayoutModelStatus(): Promise<LayoutModelStatus> {
	const cache = await caches.open(LAYOUT_MODEL_CACHE);
	const response = await cache.match(layoutModelLocalUrl());
	const size = Number(response?.headers.get("content-length") ?? 0);
	return {
		ready: size === LAYOUT_MODEL_BYTES,
		path: layoutModelLocalUrl(),
		sizeBytes: size,
		source: response
			? "huggingface:0833193a430ce271aa434cf1eecfab19412ac6a0"
			: null,
		fileName: "pp-doclayoutv3.onnx",
	};
}
/** Only a complete, hash-verified model is published to the inference cache. */
export async function cacheLayoutModel(
	data: ArrayBuffer,
): Promise<LayoutModelStatus> {
	if (data.byteLength !== LAYOUT_MODEL_BYTES)
		throw new Error("layoutModelInvalid");
	const digest = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
	]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
	if (digest !== LAYOUT_MODEL_SHA256) throw new Error("layoutModelInvalid");
	const cache = await caches.open(LAYOUT_MODEL_CACHE);
	await cache.put(
		layoutModelLocalUrl(),
		new Response(data, {
			headers: {
				"content-length": String(data.byteLength),
				"content-type": "application/octet-stream",
			},
		}),
	);
	return getLayoutModelStatus();
}
export async function ensureLayoutModel(
	signal?: AbortSignal,
): Promise<LayoutModelStatus> {
	return navigator.locks.request(
		"agentero-layout-model",
		{ signal },
		async () => {
			const status = await getLayoutModelStatus();
			if (status.ready) return status;
			if (!navigator.onLine) throw new Error("offline");
			const response = await fetch(layoutModelLocalUrl(), {
				signal: signal ?? AbortSignal.timeout(300000),
			});
			if (!response.ok) throw new Error("layoutModelUnavailable");
			return cacheLayoutModel(await response.arrayBuffer());
		},
	);
}
/** Explicit callers may prefetch; app startup does not force a 65 MB download. */
export function prefetchLayoutModel(): Promise<LayoutModelStatus> {
	return ensureLayoutModel();
}
