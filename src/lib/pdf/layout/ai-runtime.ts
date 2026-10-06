import type { AiRuntime } from "@embedpdf/ai";
import { createAiRuntime } from "@embedpdf/ai/web";

import { layoutModelLocalUrl } from "./model";

/** Shared browser ONNX runtime, using the verified same-origin model cache. */
let runtime: AiRuntime | null = null;

export function getPdfAiRuntime(): AiRuntime {
	if (!runtime) {
		const models = { "layout-detection": { url: layoutModelLocalUrl() } };
		runtime = createAiRuntime({
			backend: "auto",
			cache: true,
			models,
		});
	}
	return runtime;
}
