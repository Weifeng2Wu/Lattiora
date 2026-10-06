import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { finishInitialSetup } from "./setup";

async function login(page: Page, home = false) {
	await page.goto("/");
	await page
		.getByLabel("Access password")
		.fill(
			process.env.AGENTERO_TEST_PASSWORD ??
				"local-development-password-32-chars",
		);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toBeVisible({ timeout: 90000 });
	await finishInitialSetup(page, { stayOnHome: home });
}
async function sync(page: Page) {
	const button = page.getByRole("button", { name: "Sync now", exact: true });
	await expect(button).toBeEnabled({ timeout: 90000 });
	await button.click();
	await expect(button).toBeEnabled({ timeout: 90000 });
}
async function write(page: Page, path: string, content: string, version = 0) {
	const response = await page.request.put("/api/file", {
		headers: { origin: new URL(page.url()).origin },
		data: {
			path,
			content,
			version,
			mutation_id: crypto.randomUUID(),
			deleted: false,
			mime: path.endsWith(".json") ? "application/json" : "text/markdown",
			blob_key: null,
		},
	});
	expect(response.ok()).toBe(true);
}
async function records(page: Page, prefix: string) {
	return page.evaluate(async (prefix) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("agentero-cloud-v1", 1);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const files = await new Promise<
			Array<{ path: string; data: Blob; dirty: boolean; deleted: number }>
		>((resolve) => {
			const request = db.transaction("files").objectStore("files").getAll();
			request.onsuccess = () => resolve(request.result);
		});
		db.close();
		return Promise.all(
			files
				.filter(
					(f) =>
						!f.deleted && f.path.startsWith(prefix) && f.path.endsWith(".json"),
				)
				.map(async (f) => ({
					path: f.path,
					dirty: f.dirty,
					value: JSON.parse(await f.data.text()),
				})),
		);
	}, prefix);
}
const storage = (page: Page) =>
	page.getByRole("toolbar", { name: "Workspace storage" });

test.beforeEach(() =>
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Uses isolated local fixtures"),
);

test("custom widgets, background and weather persist offline and synchronize to a second device", async ({
	page,
	context,
	browser,
}) => {
	test.setTimeout(240000);
	await page.route("**/api/weather/cities?**", (route) =>
		route.fulfill({
			json: {
				cities: [{ name: "Shanghai", latitude: 31.23, longitude: 121.47 }],
			},
		}),
	);
	await page.route("**/api/weather?**", (route) =>
		route.fulfill({
			json: {
				temperature: 23,
				high: 26,
				low: 19,
				code: 1,
				fetchedAt: Date.now(),
			},
		}),
	);
	await login(page, true);
	const home = page.getByRole("region", { name: "Home", exact: true });
	await home
		.getByRole("button", { name: "Customize home", exact: true })
		.click();
	const dialog = page.getByRole("dialog", { name: "Customize home" });
	for (const name of ["Weather", "Focus timer", "Recent reading"])
		await dialog.getByRole("checkbox", { name, exact: true }).check();
	await dialog
		.getByRole("checkbox", { name: "Note count", exact: true })
		.uncheck();
	await dialog
		.getByRole("combobox", { name: "Width of Weather" })
		.selectOption("4");
	await dialog
		.getByRole("button", { name: "Move Weather up", exact: true })
		.click();
	await dialog.getByLabel("Choose image", { exact: true }).setInputFiles({
		name: "background.png",
		mimeType: "image/png",
		buffer: Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
			"base64",
		),
	});
	await dialog.getByRole("slider", { name: /Blur/ }).fill("14");
	await dialog.getByRole("slider", { name: /Overlay/ }).fill("60");
	await dialog.getByLabel("Search city…").fill("Shanghai");
	await dialog.getByRole("button", { name: "Search", exact: true }).click();
	await dialog.getByRole("button", { name: "Shanghai", exact: true }).click();
	await dialog
		.getByRole("button", { name: "Save layout", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	await expect(home.locator("[data-home-background]")).toHaveCSS(
		"filter",
		"blur(14px)",
	);
	await expect(home.locator('[data-home-widget="weather"]')).toContainText(
		"23°",
	);
	await expect(home.locator('[data-home-widget="notes"]')).toHaveCount(0);
	await home.getByRole("button", { name: "Start timer" }).click();
	await expect(home.getByRole("button", { name: "Pause timer" })).toBeVisible();
	await expect
		.poll(
			async () => (await records(page, ".agentero/home/settings"))[0]?.dirty,
		)
		.toBe(false);
	await expect(storage(page)).toContainText("Offline ready", {
		timeout: 120000,
	});
	await context.setOffline(true);
	await page.reload();
	await expect(home.locator("[data-home-background]")).toHaveCSS(
		"filter",
		"blur(14px)",
	);
	await expect(home.locator('[data-home-widget="weather"]')).toContainText(
		"23°",
	);
	await expect(home.getByRole("button", { name: "Pause timer" })).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("custom-home.png") });
	await context.setOffline(false);
	await sync(page);
	const device = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	try {
		const second = await device.newPage();
		await login(second, true);
		await storage(second)
			.getByRole("button", { name: "Home", exact: true })
			.click();
		await expect(second.locator("[data-home-background]")).toHaveCSS(
			"filter",
			"blur(14px)",
		);
		await expect(second.locator('[data-home-widget="weather"]')).toBeVisible();
		await expect
			.poll(() =>
				second.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			)
			.toBe(true);
		await second.screenshot({
			path: test.info().outputPath("custom-home-mobile.png"),
		});
	} finally {
		await device.close();
	}
});

test("graph navigation and semantic indexing retrieve saved sources, reject stale text, and remain available offline", async ({
	page,
	context,
}) => {
	test.setTimeout(240000);
	const prefix = `research-${Date.now()}`;
	let embeddings = 0;
	await page.route("**/api/embedding", (route) => {
		embeddings++;
		const body = route.request().postDataJSON();
		return route.fulfill({
			json: {
				vectors: body.input.map((text: string) =>
					/visual|image/i.test(text) ? [1, 0] : [0, 1],
				),
			},
		});
	});
	await login(page);
	const a = `notes/${prefix}-a.md`,
		b = `notes/${prefix}-b.md`;
	await write(
		page,
		a,
		`# ${prefix} Visual\n\nVisual representation learning.\n\n[[${prefix}-b]]`,
	);
	await write(page, b, `# ${prefix} Language\n\nSyntax and grammar.`);
	await sync(page);
	await storage(page)
		.getByRole("button", { name: "Relationship graph", exact: true })
		.click();
	const graph = page.locator("[data-research-graph]");
	await graph.getByLabel("Find papers and notes…").fill(prefix);
	await expect(graph.locator("[data-node-id]")).toHaveCount(2);
	await expect(graph).toContainText("2 nodes · 1 connections");
	await graph.locator(`[data-node-id="${a}"]`).press("Enter");
	await graph.getByRole("button", { name: "Focus", exact: true }).click();
	await expect(
		graph.getByRole("button", { name: "Show full graph", exact: true }),
	).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("graph.png") });
	await graph.getByRole("button", { name: "Open", exact: true }).click();
	await expect(
		page
			.locator('[data-slate-editor="true"]')
			.filter({ visible: true })
			.first(),
	).toContainText("Visual representation learning");
	await storage(page)
		.getByRole("button", { name: "Semantic search", exact: true })
		.click();
	const search = page.getByRole("region", {
		name: "Semantic search",
		exact: true,
	});
	await search
		.getByRole("button", { name: "Embedding settings", exact: true })
		.click();
	await page
		.locator("#agent-embedding-base-url")
		.fill("https://embedding.test/v1");
	await page.locator("#agent-embedding-base-url").blur();
	await page
		.locator("#agent-embedding-model")
		.fill(`search-fixture-${Date.now()}`);
	await page.locator("#agent-embedding-model").blur();
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await search
		.getByRole("button", { name: "Update index", exact: true })
		.click();
	await expect(
		search.getByRole("button", { name: "Update index", exact: true }),
	).toBeEnabled({ timeout: 90000 });
	await search.getByLabel("Describe what you want to find…").fill("image");
	await search.getByRole("button", { name: "Search by meaning" }).click();
	await expect(search.getByRole("button").filter({ hasText: a })).toContainText(
		"Visual representation learning",
	);
	const count = embeddings;
	await search
		.getByRole("button", { name: "Update index", exact: true })
		.click();
	await expect(
		search.getByRole("button", { name: "Update index", exact: true }),
	).toBeEnabled();
	expect(embeddings).toBe(count);
	await expect(storage(page)).toContainText("Offline ready", {
		timeout: 120000,
	});
	await context.setOffline(true);
	await page.reload();
	await expect(search).toBeVisible({ timeout: 90000 });
	await search.getByLabel("Describe what you want to find…").fill("image");
	await search.getByRole("button", { name: "Search by meaning" }).click();
	await expect(search.getByRole("button").filter({ hasText: a })).toBeVisible();
	expect(embeddings).toBe(count);
	await context.setOffline(false);
	await write(page, a, "# Updated\n\nLanguage only.", 1);
	await sync(page);
	await search.getByRole("button", { name: "Search by meaning" }).click();
	await expect(search.getByRole("button").filter({ hasText: a })).toHaveCount(
		0,
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await storage(page)
		.getByRole("button", { name: "Relationship graph", exact: true })
		.click();
	await graph.getByLabel("Find papers and notes…").fill(prefix);
	await expect(graph.locator(`[data-node-id="${b}"]`)).toBeVisible();
	await graph.locator(`[data-node-id="${b}"]`).press("Enter");
	await graph.getByRole("button", { name: "Open", exact: true }).click();
	await expect(page.locator("pre")).toContainText("Syntax and grammar");
});

test("PDF progress counts visited pages rather than furthest page and ignores a hidden reader", async ({
	page,
	context,
}) => {
	test.setTimeout(240000);
	await page.route("**/api/embedding", (route) =>
		route.fulfill({
			json: {
				vectors: route
					.request()
					.postDataJSON()
					.input.map((text: string) =>
						/receptor/.test(text) ? [1, 0] : [0, 1],
					),
			},
		}),
	);
	await login(page);
	const title = `visited-${Date.now()}`;
	const pdf = await PDFDocument.create();
	for (let i = 1; i <= 5; i++)
		pdf
			.addPage([600, 800])
			.drawText(
				`Actual reading page ${i}. Scientific research content. ${i === 5 ? "Target receptor mechanism." : ""}`,
				{
					x: 30,
					y: 700,
					size: 14,
				},
			);
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const chooser = page.waitForEvent("filechooser");
	await page
		.getByRole("menuitem", { name: "Import PDF to library", exact: true })
		.click();
	await (await chooser).setFiles({
		name: `${title}.pdf`,
		mimeType: "application/pdf",
		buffer: Buffer.from(await pdf.save()),
	});
	await page.getByRole("row").filter({ hasText: title }).click();
	const progress = async () =>
		(await records(page, `papers/${title}/.reading/`))
			.filter((f) => f.value.pages)
			.flatMap((f) => f.value.pages as number[]);
	await expect.poll(progress, { timeout: 60000 }).toContain(1);
	const input = page
		.getByRole("textbox", { name: "Go to page", exact: true })
		.filter({ visible: true });
	await storage(page)
		.getByRole("button", { name: "Semantic search", exact: true })
		.click();
	const search = page.getByRole("region", {
		name: "Semantic search",
		exact: true,
	});
	await search
		.getByRole("button", { name: "Update index", exact: true })
		.click();
	await expect(
		search.getByRole("button", { name: "Update index", exact: true }),
	).toBeEnabled({ timeout: 90000 });
	await search.getByLabel("Describe what you want to find…").fill("receptor");
	await search
		.getByRole("button", { name: "Search by meaning", exact: true })
		.click();
	const hit = search
		.getByRole("button")
		.filter({ hasText: `papers/${title}/paper.pdf` });
	await expect(hit).toContainText("Page 5");
	await hit.click();
	await expect(input).toHaveValue("5");
	await expect.poll(progress).toEqual([1, 5]);
	await input.fill("3");
	await input.press("Enter");
	await storage(page)
		.getByRole("button", { name: "Home", exact: true })
		.click();
	await page.waitForTimeout(2500);
	expect(await progress()).toEqual([1, 5]);
	await expect(storage(page)).toContainText("Offline ready", {
		timeout: 120000,
	});
	await context.setOffline(true);
	await page.reload();
	expect(await progress()).toEqual([1, 5]);
});
