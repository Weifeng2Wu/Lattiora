import { describe, expect, it } from "vitest";

import {
	buildTranslatePrompt,
	COMMERCIAL_MT_PROVIDER_IDS,
	FREE_MT_PROVIDER_IDS,
	getTranslateService,
	isCommercialProviderConfigured,
	isCommercialTranslateProvider,
	isFreeMtProvider,
	isTranslateApiKeyMask,
	isTranslateProviderId,
	langsFromSettings,
	listSelectableProviders,
	maskTranslateApiKey,
	resolveTargetLangCode,
	resolveTargetLangName,
	resolveTranslateAgent,
	targetLangDisplayName,
} from "@/lib/translate";
import { DEFAULT_TRANSLATE_SETTINGS } from "@/lib/translate/defaults";

describe("translate lang", () => {
	it("resolves ui target from interface language", () => {
		expect(resolveTargetLangCode("ui", "zh-CN")).toBe("zh-CN");
		expect(resolveTargetLangCode("ui", "en")).toBe("en");
		expect(resolveTargetLangCode("en", "zh-CN")).toBe("en");
		expect(resolveTargetLangName("ui", "zh-CN")).toBe("Chinese");
		expect(resolveTargetLangName("en", "zh-CN")).toBe("English");
	});

	it("maps codes and names via targetLangDisplayName", () => {
		expect(targetLangDisplayName("zh-CN")).toBe("Chinese");
		expect(targetLangDisplayName("zh")).toBe("Chinese");
		expect(targetLangDisplayName("en")).toBe("English");
		expect(targetLangDisplayName("Chinese")).toBe("Chinese");
		expect(targetLangDisplayName("English")).toBe("English");
	});

	it("builds langs from settings", () => {
		const l = langsFromSettings(
			{ ...DEFAULT_TRANSLATE_SETTINGS, targetLang: "ui" },
			"zh-CN",
		);
		expect(l.sourceLang).toBe("auto");
		expect(l.targetLang).toBe("zh-CN");
		expect(l.targetLangName).toBe("Chinese");
	});
});

describe("translate services registry", () => {
	it("registers free web engines, commercial BYOK engines, and agent", () => {
		for (const id of FREE_MT_PROVIDER_IDS) {
			expect(getTranslateService(id)?.kind).toBe("free-mt");
			expect(getTranslateService(id)?.requireSecret).toBe(false);
		}
		for (const id of COMMERCIAL_MT_PROVIDER_IDS) {
			expect(getTranslateService(id)?.kind).toBe("commercial-mt");
			expect(getTranslateService(id)?.requireSecret).toBe(true);
		}
		expect(getTranslateService("agent")?.kind).toBe("agent");
		expect(getTranslateService("agent")?.requireExternalConfig).toBe(true);
		expect(isTranslateProviderId("deepl")).toBe(true);
		expect(isCommercialTranslateProvider("deepl")).toBe(true);
		expect(isFreeMtProvider("deeplx")).toBe(true);
		expect(isFreeMtProvider("agent")).toBe(false);
		expect(isFreeMtProvider("deepl")).toBe(false);
	});

	it("settings list includes free engines, commercial BYOK engines, and agent", () => {
		const ids = listSelectableProviders().map((s) => s.id);
		expect(ids).toContain("googleapi");
		expect(ids).toContain("tencenttransmart");
		expect(ids).toContain("huoshanweb");
		expect(ids).toContain("deeplx");
		expect(ids).toContain("deepl");
		expect(ids).toContain("azure");
		expect(ids).toContain("googleCloud");
		expect(ids).toContain("openaiCompatible");
		expect(ids).toContain("agent");
	});

	it("requires configured AI by default", () => {
		expect(DEFAULT_TRANSLATE_SETTINGS.provider).toBe("agent");
		expect(DEFAULT_TRANSLATE_SETTINGS.agentId).toBe("");
		expect(DEFAULT_TRANSLATE_SETTINGS.modelId).toBe("");
	});

	it("keeps commercial engines out of free-MT probes", () => {
		for (const id of FREE_MT_PROVIDER_IDS) {
			expect(isFreeMtProvider(id)).toBe(true);
		}
		for (const id of COMMERCIAL_MT_PROVIDER_IDS) {
			expect(isFreeMtProvider(id)).toBe(false);
		}
	});

	it("treats same-length host API key mask as configured", () => {
		expect(
			isCommercialProviderConfigured("deepl", {
				apiKey: "********",
				baseUrl: "",
				region: "",
				model: "",
			}),
		).toBe(false);
		const masked = maskTranslateApiKey("sk-secret-key");
		expect(masked).toBe("*************");
		expect(isTranslateApiKeyMask(masked)).toBe(true);
		expect(isTranslateApiKeyMask("sk-secret")).toBe(false);
		expect(
			isCommercialProviderConfigured("deepl", {
				apiKey: masked,
				baseUrl: "https://translation.test",
				region: "",
				model: "",
			}),
		).toBe(true);
		expect(
			isCommercialProviderConfigured("deepl", {
				apiKey: "",
				baseUrl: "https://translation.test",
				region: "",
				model: "",
			}),
		).toBe(false);
		expect(
			isCommercialProviderConfigured("azure", {
				apiKey: masked,
				baseUrl: "https://translation.test",
				region: "",
				model: "",
			}),
		).toBe(false);
		expect(
			isCommercialProviderConfigured("azure", {
				apiKey: masked,
				baseUrl: "https://translation.test",
				region: "eastasia",
				model: "",
			}),
		).toBe(true);
	});
});

describe("resolveTranslateAgent", () => {
	it("follows default agent when agentId empty", () => {
		const r = resolveTranslateAgent(
			{ agentId: "", modelId: "" },
			{
				defaultId: "codex-1",
				agents: [
					{
						id: "codex-1",
						name: "Codex",
						template: "codex-acp",
						command: "codex",
						args: [],
						env: {},
						available: true,
					},
				],
			},
		);
		expect(r.agentId).toBe("codex-1");
	});

	it("uses pinned agentId when available", () => {
		const r = resolveTranslateAgent(
			{ agentId: "claude-1", modelId: "m1" },
			{
				defaultId: "codex-1",
				agents: [
					{
						id: "codex-1",
						name: "Codex",
						template: "codex-acp",
						command: "codex",
						args: [],
						env: {},
						available: true,
					},
					{
						id: "claude-1",
						name: "Claude",
						template: "claude-acp",
						command: "claude",
						args: [],
						env: {},
						available: true,
					},
				],
			},
		);
		expect(r.agentId).toBe("claude-1");
		expect(r.modelId).toBe("m1");
	});
});

describe("translate prompts", () => {
	it("builds a generic agent prompt", () => {
		const p = buildTranslatePrompt({
			text: "Hello world",
			targetLangName: "Chinese",
		});
		expect(p).toContain("Chinese");
		expect(p).toContain("Hello world");
		expect(p).toContain("only the translation");
	});

	it("pdf selection surface includes page context", () => {
		const p = buildTranslatePrompt({
			text: "attention",
			targetLangName: "Chinese",
			page: 3,
			surface: "pdf-selection",
		});
		expect(p).toContain("page 3");
		expect(p).toContain("attention");
	});

	it("custom prompt replaces instructions but keeps app-composed parts", () => {
		const p = buildTranslatePrompt({
			text: "[[1]] alpha\n\n[[2]] beta",
			targetLangName: "Chinese",
			page: 7,
			surface: "pdf-selection",
			customPrompt:
				"Terse literary translator. {{targetLang}} from {{sourceLang}}, no preamble.",
		});
		expect(p).toContain(
			"Terse literary translator. Chinese from the source language, no preamble.",
		);
		// Built-in rules are gone.
		expect(p).not.toContain("Rules:");
		expect(p).not.toContain("academic translator");
		// Page line, [[n]] batch rules and the text payload stay app-composed.
		expect(p).toContain("page 7");
		expect(p).toContain("[[n]] marker");
		expect(p).toContain("Do not merge paragraphs.");
		expect(p.endsWith("Text:\n\n[[1]] alpha\n\n[[2]] beta")).toBe(true);
	});

	it("empty custom prompt falls back to the built-in template byte-identically", () => {
		const base = {
			text: "Hello world",
			targetLangName: "Chinese",
			page: 2,
			surface: "pdf-selection" as const,
		};
		expect(buildTranslatePrompt({ ...base, customPrompt: "" })).toBe(
			buildTranslatePrompt(base),
		);
		// The rendered default interpolates every placeholder.
		const rendered = buildTranslatePrompt(base);
		expect(rendered).toContain("Translate the text below into Chinese.");
		expect(rendered).not.toContain("{{targetLang}}");
		expect(rendered).not.toContain("{{sourceLang}}");
	});

	it("default translate settings ship an empty custom prompt", () => {
		expect(DEFAULT_TRANSLATE_SETTINGS.customPrompt).toBe("");
	});
});
