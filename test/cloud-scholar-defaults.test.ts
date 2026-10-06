import { expect, it } from "vitest";
import {
	DEFAULT_RECOGNIZER_BASE_URL,
	DEFAULT_TRANSLATOR_BASE_URL,
	normalizeScholarService,
} from "../src/lib/cloud/scholar-defaults";

it.each([
	DEFAULT_RECOGNIZER_BASE_URL,
	DEFAULT_TRANSLATOR_BASE_URL,
])("restores default %s for missing and empty settings, preserving opt-out and custom credentials", (url) => {
	for (const config of [undefined, { baseUrl: "", apiKey: "" }])
		expect(normalizeScholarService(config, url)).toEqual({
			baseUrl: url,
			apiKey: "",
			enabled: true,
		});
	expect(
		normalizeScholarService({ baseUrl: "", enabled: false }, url),
	).toMatchObject({ baseUrl: url, enabled: false });
	expect(
		normalizeScholarService(
			{ baseUrl: " https://custom.example/api ", apiKey: "***" },
			url,
		),
	).toMatchObject({ baseUrl: "https://custom.example/api", apiKey: "***" });
	expect(
		normalizeScholarService({ baseUrl: "", apiKey: "***" }, url),
	).toMatchObject({ baseUrl: "", apiKey: "***" });
});
