import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { rewritePlazaHtml } from "../../cloudflare/plaza/worker";
import { finishInitialSetup } from "./setup";

test("isolated live Plaza authenticates, runs original bridge scripts, imports and falls back to offline pages", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Public source fixture, local vault",
	);
	test.skip(
		!process.env.AGENTERO_PLAZA_COOL_URL,
		"Requires isolated Plaza proxy Workers",
	);
	test.setTimeout(180000);
	const proxyOrigin = process.env.AGENTERO_PLAZA_COOL_URL ?? "";
	await page.route(`${proxyOrigin}/**`, async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.startsWith("/_agentero/")) {
			// Playwright does not re-route HTTP redirect chains. Keep the real
			// authorization response/cookie, then navigate in script for the fixture.
			const response = await route.fetch({ maxRedirects: 0 });
			expect(response.status()).toBe(303);
			const headers = response.headers();
			const destination = headers.location;
			delete headers.location;
			await route.fulfill({
				response,
				status: 200,
				headers: { ...headers, "content-type": "text/html" },
				body: `<script>location.replace(${JSON.stringify(destination)})</script>`,
			});
			return;
		}
		// Verify the real bootstrap cookie before substituting only public upstream content.
		const cookies = await context.cookies(proxyOrigin);
		expect(
			cookies.some(
				(cookie) => cookie.name === "agentero_plaza" && cookie.httpOnly,
			),
		).toBe(true);
		const html =
			url.pathname === "/"
				? '<html><head></head><body><a href="/venue/Example">Venue</a><script>localStorage.setItem("original-script", "running")</script></body></html>'
				: `<html><head></head><body id="venue"><div class="papers"><div class="panel paper" id="${id}"><h2 class="title"><a href="https://publisher.example/paper"><span class="index">1</span></a><a id="title-${id}" href="/venue/${encodeURIComponent(id)}">${title}</a></h2><p>Research summary</p></div></div></body></html>`;
		await route.fulfill({
			contentType: "text/html",
			body: rewritePlazaHtml(html, proxyOrigin, "https://papers.cool", {
				site: "coolpapers",
				parent: new URL(page.url()).origin,
				proxy: proxyOrigin,
				expires: Date.now() + 60000,
				labels: {
					import: "[Import]",
					pending: "[Importing]",
					done: "[Imported]",
				},
			}),
		});
	});
	const title = `cool-${Date.now()}`,
		id = `${title}@VENUE`;
	let downloads = 0;
	const pdf = await PDFDocument.create();
	pdf.addPage();
	await page.route("**/api/remote-pdf?*", (route) => {
		downloads++;
		return route.fulfill({
			body: Buffer.from(pdfBytes),
			contentType: "application/pdf",
		});
	});
	const pdfBytes = await pdf.save();
	await page.route("**/api/feeds/fetch", async (route) => {
		const input = route.request().postDataJSON();
		if (!input.url.startsWith("https://papers.cool/")) {
			await route.continue();
			return;
		}
		const path = new URL(input.url).pathname;
		const html = path.includes(encodeURIComponent(id))
			? `<html><head><meta name="citation_title" content="${title}"><meta name="citation_authors" content="Alice; Bob"><meta name="citation_pdf_url" content="https://publisher.example/paper.pdf"><meta name="citation_date" content="2026-09-30"></head><body>Paper</body></html>`
			: path === "/"
				? '<html><body><a href="/venue/Example">Venue</a></body></html>'
				: `<html><body id="venue"><div class="papers"><div class="panel paper" id="${id}"><h2 class="title"><a href="https://publisher.example/paper"><span class="index">1</span></a><a id="title-${id}" href="/venue/${encodeURIComponent(id)}">${title}</a></h2><p>Research summary</p></div></div></body></html>`;
		await route.fulfill({
			json: {
				url: input.url,
				status: 200,
				contentType: "text/html",
				body: html,
			},
		});
	});
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
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await page
		.getByRole("treeitem", { name: "Cool Papers", exact: true })
		.dblclick();
	const frame = page.frameLocator('iframe[title="Cool Papers"]');
	await frame
		.getByRole("link", { name: "Venue", exact: true })
		.click({ timeout: 20000 });
	await expect(frame.getByText(title, { exact: true })).toBeVisible();
	await frame.locator(".title-import").filter({ hasText: "[Import]" }).click();
	await expect(
		frame.locator(".title-import").filter({ hasText: "[Imported]" }),
	).toBeVisible({ timeout: 45000 });
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/file?path=${encodeURIComponent(`papers/${title}/paper.pdf`)}`,
				);
				return response.ok() ? (await response.body()).length : 0;
			},
			{ timeout: 30000 },
		)
		.toBe(pdfBytes.length);
	const liveFrame = page
		.frames()
		.find((item) => item.url().startsWith(proxyOrigin));
	if (!liveFrame) throw new Error("Live frame missing");
	expect(
		await liveFrame.evaluate(() => localStorage.getItem("original-script")),
	).toBe("running");
	const firstDownloads = downloads;
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await frame.locator(".title-import").filter({ hasText: "[Import]" }).click();
	await expect(
		frame.locator(".title-import").filter({ hasText: "[Imported]" }),
	).toBeVisible();
	expect(downloads).toBe(firstDownloads);
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await expect(
		frame.getByRole("link", { name: "Venue", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Forward", exact: true }).click();
	await expect(frame.getByText(title, { exact: true })).toBeVisible();
	await context.setOffline(true);
	await page.reload();
	await expect(
		frame.getByRole("link", { name: "Venue", exact: true }),
	).toBeVisible({ timeout: 45000 });
	await frame
		.getByRole("link", { name: "Venue", exact: true })
		.click({ timeout: 20000 });
	await expect(frame.getByText(title, { exact: true })).toBeVisible();
});

test("public ModelScope original iframe renders papers and navigates to a paper", async ({
	page,
}) => {
	test.skip(
		!process.env.AGENTERO_PUBLIC_PLAZA_SMOKE,
		"Opt-in public upstream smoke",
	);
	test.setTimeout(180000);
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
	await page
		.getByRole("treeitem", { name: "ModelScope Papers", exact: true })
		.dblclick();
	const frame = page.frameLocator('iframe[title="ModelScope Papers"]');
	const paper = frame.locator('a[href*="/papers/"]').first();
	await expect(paper).toBeVisible({ timeout: 90000 });
	await paper.click();
	await expect(frame.locator(".agentero-import").first()).toBeVisible({
		timeout: 60000,
	});
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await expect(frame.locator('a[href*="/papers/"]').first()).toBeVisible({
		timeout: 60000,
	});
});
