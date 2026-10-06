import { getAiConfig } from "@/lib/cloud/ai";
import type { BuiltinProviderStatus } from "@/lib/core/bindings";
export const BUILTIN_PROVIDER_ID = "agentero" as const;
export type BuiltinProviderId = typeof BUILTIN_PROVIDER_ID;
export async function loadBuiltinProviderStatus(): Promise<BuiltinProviderStatus | null> {
	try {
		const config = await getAiConfig();
		return {
			available: Boolean(config),
			baseUrl: config?.baseUrl ?? "",
			translateModel: config?.model ?? "",
			ocrModel: config?.model ?? "",
			embeddingModel: "",
		};
	} catch {
		return null;
	}
}
