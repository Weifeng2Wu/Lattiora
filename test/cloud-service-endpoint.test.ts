import { expect, it } from "vitest";
import { serviceEndpoint } from "../cloudflare/providers";

it("joins provider root, nested and already-suffixed URLs without a double slash", () => {
	for (const base of [
		"https://service.example",
		"https://service.example/",
		"https://service.example/web",
		"https://service.example/web/",
	])
		expect(serviceEndpoint(base, "/web").href).toBe(
			"https://service.example/web",
		);
	expect(
		serviceEndpoint("https://service.example/api/v1/", "/models").href,
	).toBe("https://service.example/api/v1/models");
});
