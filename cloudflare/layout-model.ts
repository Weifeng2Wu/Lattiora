import { HttpError } from "./http";

// Public weights from the original EmbedPDF provider, pinned to an immutable revision.
// This endpoint never forwards cookies, API keys or a user-supplied URL.
export const LAYOUT_MODEL_SOURCE =
	"https://huggingface.co/datasets/embedpdf/embed-pdf-viewer/resolve/0833193a430ce271aa434cf1eecfab19412ac6a0/models/PP-DocLayoutV3-ONNX/model_fp16.onnx";
export async function layoutModelRoutes(
	request: Request,
): Promise<Response | null> {
	if (
		new URL(request.url).pathname !== "/api/layout-model" ||
		request.method !== "GET"
	)
		return null;
	const response = await fetch(LAYOUT_MODEL_SOURCE, {
		redirect: "follow",
		signal: AbortSignal.timeout(300000),
	});
	if (!response.ok || !response.body)
		throw new HttpError(502, "layoutModelUnavailable");
	if (Number(response.headers.get("content-length")) !== 65546435) {
		await response.body.cancel();
		throw new HttpError(502, "invalidProviderResponse");
	}
	// Stream through Workers; do not allocate a 65 MB ArrayBuffer in the isolate.
	return new Response(response.body, {
		headers: {
			"content-type": "application/octet-stream",
			"content-length": "65546435",
		},
	});
}
