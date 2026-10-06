import { expect, type Page } from "@playwright/test";

/** Select the built-in lookup path explicitly when a test mocks /api/lookup. */
export async function disableTranslator(page: Page, settingsOpen = false) {
	if (!settingsOpen) {
		await page
			.getByRole("toolbar", { name: "Workspace storage", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		await page.getByRole("button", { name: "General", exact: true }).click();
	}
	await page
		.getByRole("switch", {
			name: "Enable Zotero metadata service",
			exact: true,
		})
		.uncheck();
	const card = page
		.getByRole("textbox", { name: "Translator service URL", exact: true })
		.locator("../../..");
	await card.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		page.getByText("Metadata service saved", { exact: true }),
	).toBeVisible();
	if (!settingsOpen)
		await page.getByRole("button", { name: "Close", exact: true }).click();
}

/** Follow the visible first-run flow; never force clicks through its overlay. */
export async function finishInitialSetup(
	page: Page,
	options: { stayOnHome?: boolean } = {},
) {
	const start = page.getByRole("button", { name: "Start setup", exact: true });
	await start
		.waitFor({ state: "visible", timeout: 1500 })
		.catch(() => undefined);
	if (await start.isVisible()) {
		await start.click();
		await expect(
			page.getByRole("button", { name: "Select Default", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Select Default", exact: true }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await page.getByRole("button", { name: /Use configured AI/ }).click();
		await page
			.getByRole("button", {
				name: /Use (browser text regions|on-device layout model)/,
			})
			.click();
		await page
			.getByRole("button", { name: "Finish setup", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Finish setup", exact: true }),
		).toHaveCount(0);
	}
	const closeTour = page.locator(".driver-popover-close-btn");
	await closeTour
		.waitFor({ state: "visible", timeout: 4000 })
		.catch(() => undefined);
	if (await closeTour.isVisible()) await closeTour.click();
	if (!options.stayOnHome) {
		const workspace = page.getByRole("button", {
			name: "Back to workspace",
			exact: true,
		});
		if (await workspace.isVisible()) await workspace.click();
	}
}
