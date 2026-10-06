import { expect, type Page, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

async function state(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open("agentero-cloud-v1", 1);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const file = await new Promise<{ data: Blob; dirty: boolean } | undefined>(
			(resolve) => {
				const req = db
					.transaction("files")
					.objectStore("files")
					.get(".agentero/recommend/state.json");
				req.onsuccess = () => resolve(req.result);
			},
		);
		db.close();
		return file
			? { value: JSON.parse(await file.data.text()), dirty: file.dirty }
			: null;
	});
}
async function openDaily(page: Page) {
	const plaza = page.getByRole("treeitem", { name: "Plaza", exact: true });
	if ((await plaza.getAttribute("aria-expanded")) !== "true")
		await plaza.click();
	await page
		.getByRole("treeitem", { name: "arXiv Daily", exact: true })
		.click();
}
test("original arXiv Daily ranks through configured embeddings, caches vectors and remains readable offline", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Provider fixtures modify settings; use an isolated local workspace.",
	);
	test.setTimeout(240000);
	let embeddingBatches = 0,
		feedCalls = 0;
	await page.route("**/api/embedding", async (route) => {
		const body = route.request().postDataJSON();
		if (body.input.length > 1) embeddingBatches++;
		await route.fulfill({
			json: {
				vectors: body.input.map((text: string) =>
					text.startsWith("Vision") ? [1, 0] : [0, 1],
				),
				dim: 2,
				latencyMs: 1,
			},
		});
	});
	await page.route("**/api/recommend/feed", async (route) => {
		feedCalls++;
		await route.fulfill({
			json: {
				url: "https://rss.arxiv.org/rss/cs.AI",
				status: 200,
				contentType: "application/rss+xml",
				etag: null,
				lastModified: null,
				body: '<rss version="2.0"><channel><title>arXiv</title><item><title>Vision candidate</title><link>https://arxiv.org/abs/2609.00001</link><guid>one</guid><description>Image models</description></item><item><title>Language candidate</title><link>https://arxiv.org/abs/2609.00002</link><guid>two</guid><description>Text models</description></item></channel></rss>',
			},
		});
	});
	await page.route("**/api/lookup?*", (route) =>
		route.fulfill({
			json: {
				exact: true,
				papers: [
					{
						title: "Vision candidate",
						arxiv_id: "2609.00001",
						authors: ["Fixture"],
						abstract: "Image models",
					},
				],
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
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const picker = page.waitForEvent("filechooser");
	await page
		.getByRole("menuitem", { name: "Import BibTeX / RIS / JSON", exact: true })
		.click();
	await (await picker).setFiles({
		name: "corpus.json",
		mimeType: "application/json",
		buffer: Buffer.from(
			JSON.stringify([{ title: "Vision corpus", abstract: "Visual research" }]),
		),
	});
	await page
		.getByRole("toolbar", { name: "Workspace storage" })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Agent", exact: true }).click();
	await page
		.locator("#agent-embedding-base-url")
		.fill("https://embedding.test/v1");
	await page.locator("#agent-embedding-base-url").blur();
	const model = `recommend-fixture-${Date.now()}`;
	await page.locator("#agent-embedding-model").fill(model);
	await page.locator("#agent-embedding-model").blur();
	await page.locator("#agent-embedding-api-key").fill("recommend-fixture-key");
	await page.locator("#agent-embedding-api-key").blur();
	await expect(page.locator("#agent-embedding-api-key")).toHaveValue(/^\*+$/);
	await page
		.locator('[data-settings-pane][data-active="true"]')
		.getByRole("button", { name: "Test connection", exact: true })
		.last()
		.click();
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await openDaily(page);
	await expect(page.locator('[title="Vision candidate"]')).toBeVisible();
	await expect
		.poll(async () => (await state(page))?.value.config)
		.toContain(model);
	const stored = await state(page);
	expect(stored?.value.result.items[0].title).toBe("Vision candidate");
	expect(stored?.value.result.corpusSize).toBeGreaterThan(0);
	expect(embeddingBatches).toBe(1);
	const feedsBefore = feedCalls;
	await page
		.getByTestId("source")
		.filter({ visible: true })
		.getByRole("button", { name: "Recompute recommendations", exact: true })
		.click();
	await expect.poll(() => feedCalls).toBeGreaterThan(feedsBefore);
	await expect(
		page.getByTestId("source").filter({ visible: true }).getByRole("button", {
			name: "Recompute recommendations",
			exact: true,
		}),
	).toBeEnabled();
	expect(embeddingBatches).toBe(1);
	const card = page
		.locator(".group.relative.rounded-lg")
		.filter({ has: page.locator('[title="Vision candidate"]') });
	await card.getByRole("button", { name: "Import paper", exact: true }).click();
	await expect(card.getByLabel("Imported", { exact: true })).toBeVisible();
	await expect(
		page
			.getByRole("toolbar", { name: "Workspace storage" })
			.getByRole("status"),
	).toContainText("Offline ready", { timeout: 120000 });
	await context.setOffline(true);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible();
	await openDaily(page);
	await expect(page.locator('[title="Vision candidate"]')).toBeVisible();
	await page
		.getByTestId("source")
		.filter({ visible: true })
		.getByRole("button", { name: "Recompute recommendations", exact: true })
		.click();
	await expect(page.locator('[title="Vision candidate"]')).toBeVisible();
	expect(embeddingBatches).toBe(1);
	await context.setOffline(false);
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect
		.poll(async () => (await state(page))?.dirty, { timeout: 60000 })
		.toBe(false);
});
