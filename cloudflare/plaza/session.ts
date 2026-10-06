import { HttpError, json, readJson } from "../http";
import type { Env } from "../worker";
import { signPlazaGrant } from "./auth";

export async function plazaSession(
	request: Request,
	env: Env,
): Promise<Response | null> {
	if (
		new URL(request.url).pathname !== "/api/plaza/session" ||
		request.method !== "POST"
	)
		return null;
	const input = (await readJson(request, 2048)) as {
		site?: string;
		labels?: { import: string; pending: string; done: string };
	};
	if (!input || !["coolpapers", "modelscope"].includes(input.site ?? ""))
		throw new HttpError(400, "invalidRequest");
	const raw =
		input.site === "coolpapers"
			? env.PLAZA_COOL_ORIGIN
			: input.site === "modelscope"
				? env.PLAZA_MODELSCOPE_ORIGIN
				: null;
	if (!raw) throw new HttpError(503, "setupRequired");
	const proxy = new URL(raw),
		parent = new URL(request.url);
	if (
		proxy.origin === parent.origin ||
		proxy.href !== `${proxy.origin}/` ||
		proxy.username ||
		proxy.password ||
		!(
			proxy.protocol === "https:" ||
			(proxy.protocol === "http:" &&
				["127.0.0.1", "localhost"].includes(proxy.hostname))
		)
	)
		throw new HttpError(503, "setupRequired");
	// Local development must explicitly configure local proxies, never navigate into production using development grants.
	if (
		["127.0.0.1", "localhost"].includes(parent.hostname) &&
		!["127.0.0.1", "localhost"].includes(proxy.hostname)
	)
		throw new HttpError(503, "setupRequired");
	const labels = input.labels;
	if (
		!labels ||
		[labels.import, labels.pending, labels.done].some(
			(value) => typeof value !== "string" || value.length > 80,
		)
	)
		throw new HttpError(400, "invalidRequest");
	const token = await signPlazaGrant(
		{
			site: input.site as "coolpapers" | "modelscope",
			parent: parent.origin,
			proxy: proxy.origin,
			expires: Date.now() + 6 * 3600_000,
			labels,
		},
		env.ENCRYPTION_KEY,
	);
	return json({
		origin: proxy.origin,
		bootstrap: `${proxy.origin}/_agentero/auth?grant=${encodeURIComponent(token)}`,
	});
}
