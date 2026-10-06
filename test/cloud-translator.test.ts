import { afterEach, expect, it, vi } from "vitest";
import { mapTranslatorItem, translatorRoutes } from "../cloudflare/translator";
import type { Env } from "../cloudflare/worker";

vi.mock("../cloudflare/settings", () => ({
	readSettingsSecret: async () => "server-only-key",
}));
afterEach(() => vi.unstubAllGlobals());
const request = (body: unknown) =>
	new Request("https://app.example/api/translator", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
it("maps original Zotero authors, venue, DOI and publisher PDF fallback without inventing missing data", () => {
	const paper = mapTranslatorItem(
		{
			title: "Research",
			creators: [
				{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
				{ name: "Lab", creatorType: "author" },
				{ name: "Ignored", creatorType: "reviewer" },
			],
			url: "https://www.ijcai.org/proceedings/2025/1",
			DOI: "10.1234/research",
			date: "2025-08-01",
			abstractNote: "Evidence",
			proceedingsTitle: "IJCAI",
		},
		"Research",
	);
	expect(paper).toMatchObject({
		title: "Research",
		authors: ["Ada Lovelace", "Lab"],
		doi: "10.1234/research",
		publication: "IJCAI",
		year: 2025,
		pdf_url: "https://www.ijcai.org/proceedings/2025/0001.pdf",
	});
	expect(mapTranslatorItem({ error: "challenge" }, "Research")).toBeNull();
});
it("uses the original text/plain web/search protocols, saved secrets and exact identifier semantics", async () => {
	const calls: Array<[string, RequestInit]> = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: URL, init: RequestInit) => {
			calls.push([url.href, init]);
			return Response.json([
				{
					title: "A book",
					ISBN: "9780123456789",
					creators: [{ name: "Author" }],
					attachments: [
						{
							mimeType: "application/pdf",
							url: "https://publisher.example/book.pdf",
						},
					],
				},
			]);
		}),
	);
	const result = await translatorRoutes(
		request({
			baseUrl: "https://translator.example/base",
			operation: "lookup",
			query: "ISBN:9780123456789",
			apiKey: "********",
		}),
		{} as Env,
	);
	expect(await result?.json()).toMatchObject({
		exact: true,
		papers: [
			{ id: "9780123456789", pdf_url: "https://publisher.example/book.pdf" },
		],
	});
	expect(calls[0][0]).toBe("https://translator.example/base/search");
	expect(calls[0][1].body).toBe("9780123456789");
	expect(new Headers(calls[0][1].headers).get("authorization")).toBe(
		"Bearer server-only-key",
	);
	expect(new Headers(calls[0][1].headers).get("content-type")).toBe(
		"text/plain",
	);
	expect(calls[0][1].redirect).toBe("manual");
	await translatorRoutes(
		request({
			baseUrl: "https://translator.example",
			operation: "lookup",
			query: "https://publisher.example/paper",
			apiKey: "draft-key",
		}),
		{} as Env,
	);
	expect(calls[1][0]).toBe("https://translator.example/web");
	expect(new Headers(calls[1][1].headers).get("authorization")).toBe(
		"Bearer draft-key",
	);
	const search = await translatorRoutes(
		request({
			baseUrl: "https://translator.example",
			operation: "lookup",
			query: "A book",
		}),
		{} as Env,
	);
	expect(await search?.json()).toMatchObject({ exact: false });
});
it("rejects unsafe service endpoints and a successful HTTP response with no valid Zotero paper", async () => {
	const fetcher = vi.fn(async () => Response.json({ error: "bot challenge" }));
	vi.stubGlobal("fetch", fetcher);
	await expect(
		translatorRoutes(
			request({ baseUrl: "http://127.0.0.1:1969", operation: "probe" }),
			{} as Env,
		),
	).rejects.toMatchObject({ message: "invalidEndpoint" });
	expect(fetcher).not.toHaveBeenCalled();
	await expect(
		translatorRoutes(
			request({ baseUrl: "https://translator.example", operation: "probe" }),
			{} as Env,
		),
	).rejects.toMatchObject({ message: "paperNotFound" });
});
it("keeps bibliography import bytes intact on the original import endpoint", async () => {
	let payload: RequestInit | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: URL, init: RequestInit) => {
			expect(url.href).toBe("https://translator.example/import");
			payload = init;
			return Response.json([{ title: "Imported record", creators: [] }]);
		}),
	);
	const content = "%0 Journal Article\n%T Imported record\n";
	const result = await translatorRoutes(
		request({
			baseUrl: "https://translator.example",
			operation: "import",
			content,
		}),
		{} as Env,
	);
	expect(payload?.body).toBe(content);
	expect(await result?.json()).toMatchObject({
		exact: false,
		papers: [{ title: "Imported record" }],
	});
});

it("uses the public default for a DOI lookup without forwarding custom credentials", async () => {
	vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
		expect(url.href).toBe("https://translate.manubot.org/search");
		expect(init.body).toBe("10.1038/nphys1170");
		expect(new Headers(init.headers).has("authorization")).toBe(false);
		return Response.json([
			{ title: "Measured measurement", DOI: "10.1038/nphys1170" },
		]);
	});
	const response = await translatorRoutes(
		request({ operation: "probe", apiKey: "old-custom-key" }),
		{} as Env,
	);
	expect(await response?.json()).toMatchObject({
		exact: true,
		papers: [{ doi: "10.1038/nphys1170" }],
	});
});
