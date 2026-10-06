import { expect, test } from "@playwright/test";
import { disableTranslator, finishInitialSetup } from "./setup";

test("original magic wand imports public web metadata and body with offline HTML reading", async ({
	page,
	context,
}) => {
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Local public article fixture");
	test.setTimeout(180000);
	const title = `web-paper-${Date.now()}`;
	const url = `https://article.example/${title}`;
	let lookups = 0;
	await page.route("**/api/lookup?*", (route) => {
		lookups++;
		return route.fulfill({ json: { exact: false, papers: [] } });
	});
	await page.route("**/api/feeds/fetch", (route) =>
		route.fulfill({
			json: {
				url,
				contentType: "text/html",
				body: `<!doctype html><html><head><title>${title}</title><meta name="author" content="Research Author"><meta property="article:published_time" content="2026-09-30"><meta name="description" content="Public article summary"></head><body><nav>Unwanted navigation</nav><article><h1>${title}</h1><h2>Method</h2><p>Original article text with <strong>important evidence</strong> and a <a href="/references">source link</a>.</p><pre><code>const result = 42;</code></pre><p>${"Research documents must remain accessible offline and preserve scientific context. ".repeat(15)}</p><table><tr><th>Method</th><th>Score</th></tr><tr><td>Browser</td><td>42</td></tr></table><script>parent.pwned=true</script></article></body></html>`,
			},
		}),
	);
	await page.goto("/");
	await page
		.getByLabel("Access password")
		.fill(
			process.env.AGENTERO_TEST_PASSWORD ??
				"local-development-password-32-chars",
		);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible({ timeout: 90000 });
	await finishInitialSetup(page);
	await disableTranslator(page);
	const add = async () => {
		await page.locator("[data-magic-wand]").click();
		const input = page.getByPlaceholder(
			"arXiv / DOI, paper title, GitHub Skill URL…",
		);
		await input.fill(url);
		await input.press("Enter");
	};
	await add();
	await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
	const path = `papers/${title}`;
	let body = "";
	await expect
		.poll(
			async () => {
				const r = await page.request.get(
					`/api/file?path=${encodeURIComponent(`${path}/PAPER.md`)}`,
				);
				body = r.ok() ? await r.text() : "";
				return body;
			},
			{ timeout: 30000 },
		)
		.toContain("important evidence");
	expect(body).toContain("https://article.example/references");
	expect(body).toContain("const result = 42;");
	expect(body).toContain("<table>");
	expect(body).not.toContain("parent.pwned");
	expect(body).not.toContain("Unwanted navigation");
	const metadata = await (
		await page.request.get(
			`/api/file?path=${encodeURIComponent(`${path}/.paper.json`)}`,
		)
	).json();
	expect(metadata.authors).toEqual(["Research Author"]);
	expect(metadata.year).toBe(2026);
	expect(metadata.html_url).toBe(url);
	expect(lookups).toBe(0);
	await add();
	await page.getByRole("row").filter({ hasText: title }).click();
	const frame = page.frameLocator('iframe[title="HTML paper sandbox"]');
	await expect(
		frame.getByRole("heading", { name: title, exact: true }),
	).toBeVisible({ timeout: 45000 });
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await page.reload();
	await expect(
		frame.getByRole("heading", { name: title, exact: true }),
	).toBeVisible({ timeout: 45000 });
});
