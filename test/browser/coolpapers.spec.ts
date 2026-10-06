import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { finishInitialSetup } from "./setup";

test("original Cool Papers frame navigates, imports publisher metadata and PDF, and reopens cached pages offline", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Public source fixture, local vault",
	);
	test.setTimeout(180000);
	const title = `cool-${Date.now()}`,
		id = `${title}@VENUE`;
	let downloads = 0;
	const pdf = await PDFDocument.create();
	pdf.addPage();
	await page.route("**/api/remote-pdf?*", (route) => {
		downloads++;
		expect(new URL(route.request().url()).searchParams.get("url")).toBe(
			"https://www.ijcai.org/proceedings/2025/0001.pdf",
		);
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
			? `<html><head><meta name="citation_title" content="${title}"><meta name="citation_authors" content="Alice; Bob"><meta name="citation_public_url" content="https://www.ijcai.org/proceedings/2025/1"><meta name="citation_date" content="2026-09-30"></head><body>Paper</body></html>`
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
	await frame.getByRole("link", { name: "Venue", exact: true }).click();
	await expect(frame.getByText(title, { exact: true })).toBeVisible();
	await frame.getByRole("button", { name: "[Import]", exact: true }).click();
	await expect(
		frame.getByRole("button", { name: "[Imported]", exact: true }),
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
	const firstDownloads = downloads;
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await frame.getByRole("button", { name: "[Import]", exact: true }).click();
	await expect(
		frame.getByRole("button", { name: "[Imported]", exact: true }),
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
	await frame.getByRole("link", { name: "Venue", exact: true }).click();
	await expect(frame.getByText(title, { exact: true })).toBeVisible();
});
