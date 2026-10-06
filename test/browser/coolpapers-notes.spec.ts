import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("original NOTES toolbar appends public Kimi FAQ once and reuses it offline", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Local vault and public analysis fixture",
	);
	test.setTimeout(180000);
	const title = `cool-notes-${Date.now()}`;
	let requests = 0;
	await page.route("**/api/coolpapers/analysis", async (route) => {
		requests++;
		const input = route.request().postDataJSON();
		await route.fulfill({
			json: {
				url: input.url,
				status: 200,
				contentType: "text/plain",
				body: '<p class="faq-q"><strong>Q1</strong>: Main idea?</p><div class="faq-a">### Details\n\nPreserved $x+y$ and **Markdown**.</div><p class="faq-q">想要进一步了解论文</p><div class="faq-a">Unwanted CTA</div>',
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
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const chooser = page.waitForEvent("filechooser");
	await page
		.getByRole("menuitem", { name: "Import BibTeX / RIS / JSON", exact: true })
		.click();
	await (await chooser).setFiles({
		name: "notes.json",
		mimeType: "application/json",
		buffer: Buffer.from(
			JSON.stringify([
				{
					title,
					id: `${title}@VENUE`,
					source_url: `https://papers.cool/venue/${title}%40VENUE`,
				},
			]),
		),
	});
	await page.getByRole("row").filter({ hasText: title }).click();
	const button = page
		.locator("[data-fetch-cool-papers-notes]")
		.filter({ visible: true });
	await expect(button).toBeVisible();
	await button.click();
	await expect(
		page.getByText("Cool Papers analysis appended to NOTES.md", {
			exact: true,
		}),
	).toBeVisible();
	let saved = "";
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/file?path=${encodeURIComponent(`papers/${title}/NOTES.md`)}`,
				);
				saved = response.ok() ? await response.text() : "";
				return saved;
			},
			{ timeout: 30000 },
		)
		.toContain("Preserved $x+y$ and **Markdown**.");
	expect(saved).toContain("## Q1: Main idea?");
	expect(saved).not.toContain("Unwanted CTA");
	expect(saved).toContain(title);
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await button.click();
	await expect(
		page.getByText(
			"NOTES.md already contains this analysis; nothing was appended",
			{ exact: true },
		),
	).toBeVisible();
	expect(requests).toBe(1);
	await page.reload();
	await expect(
		page.getByText("Preserved", { exact: false }).first(),
	).toBeVisible({ timeout: 45000 });
});
