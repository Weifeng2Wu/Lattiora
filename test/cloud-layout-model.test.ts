import { afterEach, expect, it, vi } from "vitest";
import {
	LAYOUT_MODEL_SOURCE,
	layoutModelRoutes,
} from "../cloudflare/layout-model";

afterEach(() => vi.unstubAllGlobals());
it("streams only the pinned public model without forwarding user credentials", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([1, 2]));
						controller.close();
					},
				}),
				{ headers: { "content-length": "65546435" } },
			),
	);
	vi.stubGlobal("fetch", fetcher);
	const response = await layoutModelRoutes(
		new Request("https://app.test/api/layout-model?url=https://evil.test", {
			headers: { cookie: "private", authorization: "secret" },
		}),
	);
	expect(fetcher.mock.calls[0]).toEqual([
		LAYOUT_MODEL_SOURCE,
		{ redirect: "follow", signal: expect.any(AbortSignal) },
	]);
	expect(await response?.arrayBuffer()).toEqual(new Uint8Array([1, 2]).buffer);
});
it("rejects upstream error documents and incorrect model length", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("html")),
	);
	await expect(
		layoutModelRoutes(new Request("https://app.test/api/layout-model")),
	).rejects.toThrow("invalidProviderResponse");
});
