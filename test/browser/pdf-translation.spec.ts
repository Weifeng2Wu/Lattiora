import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { finishInitialSetup } from "./setup";

test("full translation opens on the first click, covers every page, and scrolls both ways", async ({
	page,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Translation fixtures use the isolated local Worker",
	);
	test.setTimeout(180000);
	const title = `translation-${Date.now()}`;
	const calls: string[] = [];
	await page.route("**/api/translate", async (route) => {
		const { text } = route.request().postDataJSON() as { text: string };
		calls.push(text);
		await route.fulfill({
			json: { text: text.replace(/Page ([123]) content/g, "第 $1 页译文") },
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
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Translate", exact: true }).click();
	await page
		.getByRole("switch", {
			name: "Open rendered translation in a side window",
			exact: true,
		})
		.check();
	await page.getByRole("button", { name: "Close", exact: true }).click();
	const hideAgent = page.getByRole("button", {
		name: "Hide right sidebar",
		exact: true,
	});
	if (await hideAgent.isVisible()) await hideAgent.click();
	const pdf = await PDFDocument.create();
	for (let number = 1; number <= 3; number++) {
		const p = pdf.addPage([600, 800]);
		p.drawText(
			`Page ${number} content. This research studies scientific methods.`,
			{ x: 50, y: 700, size: 14 },
		);
		p.drawText(`The results on this page support the proposed approach.`, {
			x: 50,
			y: 660,
			size: 14,
		});
	}
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
	await page.locator("[data-full-text-translate]").click();
	const viewports = page.locator("[data-pdf-viewport]:visible");
	await expect(viewports).toHaveCount(2);
	for (const number of [1, 2, 3])
		await expect
			.poll(
				() => calls.some((text) => text.includes(`Page ${number} content`)),
				{ timeout: 90000, message: `Page ${number} must reach translation` },
			)
			.toBe(true);
	const source = viewports.nth(0);
	const translated = viewports.nth(1);
	await expect(translated).toContainText("第 1 页译文");
	// Focusing the source must not replace the translation tab with NOTES.
	await source.click({ position: { x: 4, y: 4 } });
	await expect(viewports).toHaveCount(2);
	await source.hover();
	await page.mouse.wheel(0, 900);
	await expect
		.poll(() => source.evaluate((el) => el.scrollTop))
		.toBeGreaterThan(400);
	await expect
		.poll(() => translated.evaluate((el) => el.scrollTop))
		.toBeGreaterThan(400);
	const difference = () =>
		page
			.locator("[data-pdf-viewport]:visible")
			.evaluateAll((els) =>
				Math.abs(
					els[0].scrollTop +
						els[0].clientHeight / 2 -
						(els[1].scrollTop + els[1].clientHeight / 2),
				),
			);
	await expect.poll(difference).toBeLessThan(6);
	const before = await source.evaluate((el) => el.scrollTop);
	await translated.hover();
	await page.mouse.wheel(0, -350);
	await expect
		.poll(() => source.evaluate((el) => el.scrollTop))
		.toBeLessThan(before - 150);
	await expect.poll(difference).toBeLessThan(6);
	await translated.hover();
	// Returning to the earlier synchronized endpoint is new input, not an echo.
	await page.mouse.wheel(0, 2400);
	await expect(translated).toContainText("第 3 页译文");
	await expect.poll(difference).toBeLessThan(6);
	await page.screenshot({ path: "test-results/pdf-full-translation.png" });
});
