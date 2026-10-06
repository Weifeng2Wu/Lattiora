import { z } from "zod";
import { HttpError, json } from "./http";
import { providerJson } from "./providers";

/** Fixed public upstreams; never accept arbitrary proxy destinations. */
export async function weatherRoutes(request: Request) {
	const url = new URL(request.url);
	if (url.pathname !== "/api/weather" && url.pathname !== "/api/weather/cities")
		return null;
	if (request.method !== "GET") throw new HttpError(405, "methodNotAllowed");
	const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
	if (url.pathname.endsWith("/cities")) {
		const name = url.searchParams.get("q")?.trim() ?? "";
		if (name.length < 2 || name.length > 100)
			throw new HttpError(400, "invalidRequest");
		const target = new URL("https://geocoding-api.open-meteo.com/v1/search");
		target.search = new URLSearchParams({
			name,
			count: "6",
			language: url.searchParams.get("lang") === "zh" ? "zh" : "en",
			format: "json",
		}).toString();
		const data = await providerJson(target.toString(), {}, signal);
		const parsed = z
			.object({
				results: z
					.array(
						z.object({
							name: z.string(),
							country: z.string().optional(),
							admin1: z.string().optional(),
							latitude: z.number(),
							longitude: z.number(),
						}),
					)
					.optional(),
			})
			.safeParse(data);
		if (!parsed.success) throw new HttpError(502, "invalidProviderResponse");
		return json({
			cities: (parsed.data.results ?? []).map((city) => ({
				name: [
					city.name,
					city.admin1 !== city.name ? city.admin1 : "",
					city.country,
				]
					.filter(Boolean)
					.join(", "),
				latitude: city.latitude,
				longitude: city.longitude,
			})),
		});
	}
	const coordinates = z
		.object({
			latitude: z.coerce.number().min(-90).max(90),
			longitude: z.coerce.number().min(-180).max(180),
		})
		.safeParse({
			latitude: url.searchParams.get("latitude") ?? "invalid",
			longitude: url.searchParams.get("longitude") ?? "invalid",
		});
	if (!coordinates.success) throw new HttpError(400, "invalidRequest");
	const target = new URL("https://api.open-meteo.com/v1/forecast");
	target.search = new URLSearchParams({
		latitude: String(coordinates.data.latitude),
		longitude: String(coordinates.data.longitude),
		current: "temperature_2m,weather_code",
		daily: "temperature_2m_max,temperature_2m_min",
		forecast_days: "1",
		timezone: "auto",
	}).toString();
	const data = await providerJson(target.toString(), {}, signal);
	const parsed = z
		.object({
			current: z.object({
				temperature_2m: z.number().finite(),
				weather_code: z.number().int(),
			}),
			daily: z.object({
				temperature_2m_max: z.array(z.number().finite()).min(1),
				temperature_2m_min: z.array(z.number().finite()).min(1),
			}),
		})
		.safeParse(data);
	if (!parsed.success) throw new HttpError(502, "invalidProviderResponse");
	return json({
		temperature: parsed.data.current.temperature_2m,
		code: parsed.data.current.weather_code,
		high: parsed.data.daily.temperature_2m_max[0],
		low: parsed.data.daily.temperature_2m_min[0],
		fetchedAt: Date.now(),
	});
}
