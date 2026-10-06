import { expect, type Page, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test.use({ actionTimeout: 30000 });

const password =
	process.env.AGENTERO_TEST_PASSWORD ?? "local-development-password-32-chars";
async function login(page: Page) {
	await page.goto("/");
	await page.getByLabel("Access password").fill(password);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible({ timeout: 90000 });
	await finishInitialSetup(page);
}
async function openFeeds(page: Page) {
	const plaza = page.getByRole("treeitem", { name: "Plaza", exact: true });
	await expect(plaza).toBeVisible();
	if ((await plaza.getAttribute("aria-expanded")) !== "true")
		await plaza.click();
	await page.getByRole("treeitem", { name: "Feeds", exact: true }).click();
	await expect(page.getByPlaceholder("Feed URL")).toBeVisible();
}
async function files(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const r = indexedDB.open("agentero-cloud-v1", 1);
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		const records = await new Promise<
			Array<{
				path: string;
				data: Blob | null;
				dirty: boolean;
				deleted: number;
			}>
		>((resolve, reject) => {
			const r = db.transaction("files").objectStore("files").getAll();
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		db.close();
		return Promise.all(
			records
				.filter((r) =>
					/subscription\.json$|body-.*\.json$|\.paper\.json$/.test(r.path),
				)
				.map(async (r) => ({
					path: r.path,
					dirty: r.dirty,
					deleted: r.deleted,
					text: (await r.data?.text()) ?? "",
				})),
		);
	});
}
async function rename(page: Page, from: string, to: string) {
	await page
		.getByRole("button", { name: from, exact: true })
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
	await page.getByRole("dialog").getByLabel("Rename", { exact: true }).fill(to);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Save", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: to, exact: true }),
	).toBeVisible();
}

test("original Feeds parses RSS Atom JSON, imports papers and preserves offline cross-device changes", async ({
	page,
	browser,
}) => {
	test.setTimeout(240000);
	const prefix = `Feed-${Date.now()}`;
	await test
		.info()
		.attach("fixture-prefix", { body: prefix, contentType: "text/plain" });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	let refreshFailed = false;
	await page.route("**/api/feeds/fetch", async (route) => {
		const { url, etag } = route.request().postDataJSON();
		const kind = new URL(url).pathname.split("/").at(-1);
		if (refreshFailed && kind === "rss")
			return route.fulfill({ status: 502, json: { error: "feeds.http" } });
		let contentType = "application/rss+xml";
		let body = `<rss version="2.0"><channel><title>${prefix} RSS</title><item><guid>arxiv:1706.03762</guid><title>${prefix} Paper</title><link>https://arxiv.org/abs/1706.03762</link><description><![CDATA[<p>Evidence from the feed.</p><table><tr><th>Value</th></tr><tr><td>42</td></tr></table><script>window.feedUnsafe=true</script>]]></description></item></channel></rss>`;
		if (kind === "atom")
			body = `<feed xmlns="http://www.w3.org/2005/Atom"><title>${prefix} Atom</title><entry><id>atom-1</id><title>${prefix} Atom entry</title><link href="https://feeds.example/article"/><summary>Short abstract […]</summary></entry></feed>`;
		if (kind === "json") {
			contentType = "application/feed+json";
			body = JSON.stringify({
				version: "https://jsonfeed.org/version/1.1",
				title: `${prefix} JSON`,
				items: [
					{
						id: "json-1",
						title: `${prefix} JSON entry`,
						content_text: "JSON content survives offline.",
					},
				],
			});
		}
		if (kind === "html") {
			contentType = "text/html";
			body = `<html><head><link rel="alternate" type="application/rss+xml" href="/${prefix}/discovered-rss"></head></html>`;
		}
		if (kind === "article") {
			contentType = "text/html";
			body = `<html><body><nav>Not article content</nav><article><h2>Resolved article</h2><p>Full text from the article.</p><a href="javascript:alert(1)">Unsafe link</a></article></body></html>`;
		}
		if (kind === "bad") body = "<rss>malformed";
		await route.fulfill({
			json: {
				url,
				status: etag ? 304 : 200,
				contentType,
				body: etag ? "" : body,
				etag: "fixture-etag",
				lastModified: null,
			},
		});
	});
	await page.route("**/api/lookup?*", (route) =>
		route.fulfill({
			json: {
				exact: true,
				papers: [
					{
						title: `${prefix} Imported paper`,
						arxiv_id: `${Date.now()}.fixture`,
						authors: ["Fixture"],
						abstract: "Imported metadata",
					},
				],
			},
		}),
	);
	await login(page);
	await openFeeds(page);
	for (const kind of ["rss", "atom", "json"]) {
		await page
			.getByPlaceholder("Feed URL")
			.fill(`https://feeds.example/${prefix}/${kind}`);
		await page
			.getByRole("button", { name: "Add subscription", exact: true })
			.click();
		await expect(
			page.getByRole("button", {
				name: `${prefix} ${kind === "atom" ? "Atom" : kind.toUpperCase()}`,
				exact: true,
			}),
		).toBeVisible();
	}
	await page.getByText(`${prefix} JSON entry`, { exact: true }).click();
	await expect(
		page.getByText("JSON content survives offline.", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: `${prefix} Atom`, exact: true })
		.click();
	await page.getByText(`${prefix} Atom entry`, { exact: true }).click();
	await expect(
		page.getByText("Full text from the article.", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Not article content", { exact: true }),
	).toHaveCount(0);
	await page
		.getByRole("button", { name: `${prefix} RSS`, exact: true })
		.click();
	await page.getByText(`${prefix} Paper`, { exact: true }).click();
	await expect(
		page.getByRole("cell", { name: "42", exact: true }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() => (window as unknown as { feedUnsafe?: boolean }).feedUnsafe,
		),
	).toBeUndefined();
	await page.getByRole("button", { name: "Import paper", exact: true }).click();
	await expect(page.getByText("Imported", { exact: true })).toBeVisible();
	await expect
		.poll(async () =>
			(await files(page)).some(
				(f) =>
					f.path.endsWith(".paper.json") &&
					f.text.includes(`${prefix} Imported paper`),
			),
		)
		.toBe(true);
	await page
		.getByRole("button", { name: `${prefix} RSS`, exact: true })
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Pin to top", exact: true }).click();
	await rename(page, `${prefix} RSS`, `${prefix} Saved`);
	await page
		.getByPlaceholder("Feed URL")
		.fill(`https://feeds.example/${prefix}/bad`);
	await page
		.getByRole("button", { name: "Add subscription", exact: true })
		.click();
	await expect(
		page.getByText("Could not parse this feed.", { exact: true }),
	).toBeVisible();
	await page
		.getByPlaceholder("Feed URL")
		.fill(`https://feeds.example/${prefix}/html`);
	await page
		.getByRole("button", { name: "Add subscription", exact: true })
		.click();
	await expect
		.poll(
			async () =>
				(await files(page)).filter(
					(f) =>
						!f.deleted &&
						f.path.endsWith("subscription.json") &&
						f.text.includes(prefix),
				).length,
		)
		.toBe(4);
	await page
		.getByRole("button", { name: `${prefix} Saved`, exact: true })
		.click();
	refreshFailed = true;
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(
		page.getByText("The feed operation failed.", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText(`${prefix} Paper`, { exact: true }),
	).toBeVisible();
	refreshFailed = false;
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect
		.poll(
			async () => {
				const records = (await files(page)).filter(
					(f) =>
						f.text.includes(prefix) && f.path.startsWith(".agentero/feeds/"),
				);
				return records.length > 0 && records.every((f) => !f.dirty);
			},
			{ timeout: 60000 },
		)
		.toBe(true);
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 100000 });
	const other = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		viewport: { width: 1440, height: 960 },
	});
	try {
		const b = await other.newPage();
		await login(b);
		await openFeeds(b);
		await expect(
			b.getByRole("button", { name: `${prefix} Saved`, exact: true }),
		).toBeVisible();
		await page.context().setOffline(true);
		await page.reload({ waitUntil: "domcontentloaded" });
		await openFeeds(page);
		await page
			.getByRole("button", { name: `${prefix} Saved`, exact: true })
			.click();
		await expect(
			page.getByText(`${prefix} Paper`, { exact: true }),
		).toHaveCount(1);
		await page.getByText(`${prefix} Paper`, { exact: true }).click();
		await expect(
			page.getByRole("cell", { name: "42", exact: true }),
		).toBeVisible();
		await rename(page, `${prefix} Saved`, `${prefix} Device A`);
		await rename(b, `${prefix} Saved`, `${prefix} Device B`);
		await expect
			.poll(
				async () => {
					const records = (await files(b)).filter((f) =>
						f.text.includes(`${prefix} Device B`),
					);
					return records.length > 0 && records.every((f) => !f.dirty);
				},
				{ timeout: 60000 },
			)
			.toBe(true);
		await page.context().setOffline(false);
		await expect(
			page.getByRole("button", { name: `${prefix} Device B`, exact: true }),
		).toBeVisible({ timeout: 60000 });
		await expect
			.poll(async () =>
				(await files(page)).some(
					(f) =>
						f.path.startsWith("Conflicts/") &&
						f.text.includes(`${prefix} Device A`),
				),
			)
			.toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await other.close();
	}
});
