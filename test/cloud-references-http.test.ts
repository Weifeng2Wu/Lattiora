import { afterEach, expect, it, vi } from "vitest";
import { referenceRoutes } from "../cloudflare/references";

afterEach(() => vi.unstubAllGlobals());
const request = () =>
	new Request("https://app.test/api/references", {
		method: "POST",
		body: JSON.stringify({ doi: "10.1234/example" }),
		headers: { cookie: "private", "content-type": "application/json" },
	});
it("paginates public S2 references and never forwards application credentials", async () => {
	const fetcher = vi.fn(async (url: string) =>
		Response.json(
			url.includes("offset=0")
				? {
						data: [
							{
								citedPaper: {
									title: "First",
									externalIds: { DOI: "10.1234/one" },
								},
							},
						],
						next: 1000,
					}
				: { data: [{ citedPaper: { title: "Second" } }] },
		),
	);
	vi.stubGlobal("fetch", fetcher);
	const response = await referenceRoutes(request());
	if (!response) throw new Error("Reference route was not handled");
	expect((await response.json()).citations).toHaveLength(2);
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(fetcher.mock.calls[0][0]).toContain("DOI%3A10.1234%2Fexample");
});
it("falls back to Crossref on S2 failure, preserving unstructured unresolved entries", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) =>
			url.includes("semanticscholar")
				? new Response("rate limited", { status: 429 })
				: Response.json({
						message: {
							reference: [
								{ DOI: "10.1234/one", unstructured: "Author. A paper. 2024." },
							],
						},
					}),
		),
	);
	const response = await referenceRoutes(request());
	const data = await response?.json();
	expect(data.source).toBe("crossref");
	expect(data.citations[0].raw).toContain("A paper");
	expect(data.citations[0].title).toBeUndefined();
});
it("rejects invalid identifiers before fetching", async () => {
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	await expect(
		referenceRoutes(
			new Request("https://app.test/api/references", {
				method: "POST",
				body: "null",
				headers: { "content-type": "application/json" },
			}),
		),
	).rejects.toThrow("invalidIdentifier");
	expect(fetcher).not.toHaveBeenCalled();
});
