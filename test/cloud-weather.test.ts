import { afterEach, expect, it, vi } from "vitest";
import { weatherRoutes } from "../cloudflare/weather";

afterEach(() => vi.unstubAllGlobals());
it("validates coordinates before calling a fixed forecast upstream", async () => {
	const fetch = vi.fn(async (_url: string) =>
		Response.json({
			current: { temperature_2m: 23, weather_code: 1 },
			daily: { temperature_2m_max: [26], temperature_2m_min: [19] },
		}),
	);
	vi.stubGlobal("fetch", fetch);
	await expect(
		weatherRoutes(
			new Request("https://app.test/api/weather?latitude=91&longitude=10"),
		),
	).rejects.toThrow();
	expect(fetch).not.toHaveBeenCalled();
	const response = await weatherRoutes(
		new Request("https://app.test/api/weather?latitude=31.23&longitude=121.47"),
	);
	expect(await response?.json()).toMatchObject({
		temperature: 23,
		high: 26,
		low: 19,
		code: 1,
	});
	expect(String(fetch.mock.calls[0][0])).toMatch(
		/^https:\/\/api.open-meteo.com\/v1\/forecast\?/,
	);
});
it("returns no invented cities or weather for absent and malformed upstream data", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({})),
	);
	const response = await weatherRoutes(
		new Request("https://app.test/api/weather/cities?q=Missing"),
	);
	expect(await response?.json()).toEqual({ cities: [] });
	await expect(
		weatherRoutes(
			new Request("https://app.test/api/weather?latitude=1&longitude=1"),
		),
	).rejects.toThrow();
});
