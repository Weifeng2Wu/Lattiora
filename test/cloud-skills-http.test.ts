import { afterEach, expect, it, vi } from "vitest";
import { skillRoutes } from "../cloudflare/skills";

const sha = "a".repeat(40);
const request = (body: unknown, route = "discover") =>
	new Request(`https://workspace.test/api/skills/${route}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
afterEach(() => vi.unstubAllGlobals());
it("discovers only metadata, pins a commit and preserves resource paths without credentials", async () => {
	const fetcher = vi.fn(async (url: string) => {
		if (url.includes("/commits?")) return Response.json([{ sha }]);
		if (url.includes("/git/trees/"))
			return Response.json({
				truncated: false,
				tree: [
					{
						path: "skills/test/SKILL.md",
						mode: "100644",
						type: "blob",
						size: 80,
					},
					{
						path: "skills/test/assets/a.png",
						mode: "100644",
						type: "blob",
						size: 4,
					},
				],
			});
		return new Response(
			"---\nname: test\ndescription: Test skill\n---\nRead references.",
		);
	});
	vi.stubGlobal("fetch", fetcher);
	const response = await skillRoutes(
		request({ source: "https://github.com/owner/repo" }),
	);
	expect(await response?.json()).toMatchObject({
		commit: sha,
		candidates: [
			{
				name: "test",
				files: ["skills/test/SKILL.md", "skills/test/assets/a.png"],
			},
		],
	});
	expect(fetcher).toHaveBeenCalledTimes(3);
	const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
	expect(calls[2][0]).toContain(`/${sha}/`);
	for (const [, init] of calls) {
		expect(init.redirect).toBe("manual");
		expect(new Headers(init.headers).has("authorization")).toBe(false);
		expect(new Headers(init.headers).has("cookie")).toBe(false);
	}
});
it("rejects private URLs, symbolic links, truncated trees and upstream redirects", async () => {
	const fetcher = vi.fn(async (url: string) =>
		url.includes("commits")
			? Response.json([{ sha }])
			: Response.json({
					truncated: false,
					tree: [
						{ path: "SKILL.md", mode: "100644", type: "blob" },
						{ path: "escape", mode: "120000", type: "blob" },
					],
				}),
	);
	vi.stubGlobal("fetch", fetcher);
	await expect(
		skillRoutes(request({ source: "http://localhost/repo" })),
	).rejects.toMatchObject({ status: 400 });
	expect(fetcher).not.toHaveBeenCalled();
	fetcher.mockImplementation(async (url) =>
		url.includes("commits")
			? Response.json([{ sha }])
			: url.includes("trees")
				? Response.json({
						truncated: false,
						tree: [
							{ path: "SKILL.md", mode: "100644", type: "blob" },
							{ path: "escape", mode: "120000", type: "blob" },
						],
					})
				: new Response("---\nname: test\ndescription: Test\n---\n"),
	);
	await expect(
		skillRoutes(request({ source: "github:owner/repo" })),
	).rejects.toMatchObject({ message: "skillSourceUnsafe" });
	fetcher.mockImplementation(async (url) =>
		url.includes("commits")
			? Response.json([{ sha }])
			: Response.json({ truncated: true, tree: [] }),
	);
	await expect(
		skillRoutes(request({ source: "github:owner/repo" })),
	).rejects.toMatchObject({ status: 413 });
	fetcher.mockImplementation(
		async () =>
			new Response(null, {
				status: 302,
				headers: { location: "http://localhost" },
			}),
	);
	await expect(
		skillRoutes(
			request(
				{ owner: "owner", repo: "repo", commit: sha, path: "SKILL.md" },
				"file",
			),
		),
	).rejects.toMatchObject({ status: 502 });
});
it("routes only public file downloads through the selected original mirror and probes it without credentials", async () => {
	const fetcher = vi.fn(async (url: string) =>
		url.startsWith("https://raw.githubusercontent.com")
			? new Response(null, { status: 503 })
			: new Response("fixture file"),
	);
	vi.stubGlobal("fetch", fetcher);
	const response = await skillRoutes(
		request(
			{
				owner: "owner",
				repo: "repo",
				commit: sha,
				path: "skills/test/SKILL.md",
				mirror: "https://ghproxy.net",
			},
			"file",
		),
	);
	expect(await response?.text()).toBe("fixture file");
	expect(fetcher.mock.calls[1][0]).toBe(
		`https://ghproxy.net/https://github.com/owner/repo/raw/${sha}/skills/test/SKILL.md`,
	);
	const probe = await skillRoutes(
		request({ mirror: "https://ghproxy.net" }, "probe"),
	);
	expect(await probe?.json()).toEqual({ ok: true });
	for (const [, init] of fetcher.mock.calls as unknown as [
		string,
		RequestInit,
	][]) {
		expect(new Headers(init.headers).has("authorization")).toBe(false);
		expect(new Headers(init.headers).has("cookie")).toBe(false);
		expect(init.redirect).toBe("manual");
	}
	fetcher.mockClear();
	await expect(
		skillRoutes(request({ mirror: "http://127.0.0.1" }, "probe")),
	).rejects.toMatchObject({ message: "invalidEndpoint" });
	expect(fetcher).not.toHaveBeenCalled();
});
