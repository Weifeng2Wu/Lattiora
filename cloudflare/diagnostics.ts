import { json } from "./http";
import type { Env } from "./worker";

// Fixed URLs only: diagnostics cannot be used as an arbitrary authenticated proxy.
const endpoints = [
	["baidu", "https://www.baidu.com/"],
	["google", "https://www.google.com/"],
	["google-scholar", "https://scholar.google.com/"],
	["github", "https://github.com/"],
	["arxiv", "https://arxiv.org/"],
	["semantic-scholar", "https://www.semanticscholar.org/"],
] as const;
export async function diagnosticsRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	if (
		new URL(request.url).pathname !== "/api/diagnostics" ||
		request.method !== "GET"
	)
		return null;
	const checks = await Promise.allSettled([
		env.DB.prepare("SELECT uuid FROM workspace WHERE id = 1").first(),
		env.FILES.head(".agentero-diagnostics"),
	]);
	const network = await Promise.all(
		endpoints.map(async ([id, url]) => {
			const start = Date.now();
			try {
				const response = await fetch(url, {
					method: "HEAD",
					redirect: "manual",
					signal: AbortSignal.timeout(8000),
				});
				await response.body?.cancel();
				// A HTTP denial is not a successful service check; expose the code, never its body.
				return {
					id,
					url,
					status:
						response.status >= 200 && response.status < 400
							? "reachable"
							: "unreachable",
					statusCode: response.status,
					latencyMs: Date.now() - start,
				};
			} catch (error) {
				return {
					id,
					url,
					status:
						error instanceof Error &&
						(error.name === "TimeoutError" || error.name === "AbortError")
							? "timeout"
							: "unreachable",
					latencyMs: Date.now() - start,
				};
			}
		}),
	);
	return json({
		database: checks[0].status === "fulfilled" && Boolean(checks[0].value),
		objectStorage: checks[1].status === "fulfilled",
		endpoints: network,
	});
}
