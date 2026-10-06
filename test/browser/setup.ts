import { expect, type Page } from "@playwright/test";

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
