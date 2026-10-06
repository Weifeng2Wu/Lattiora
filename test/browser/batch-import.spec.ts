import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("original batch importer runs independent inputs at the configured concurrency and exposes cancellation", async ({
	page,
}) => {
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Local lookup fixture");
	test.setTimeout(180000);
	const name = `batch-${Date.now()}`;
	const failedId = "10.1234/batch-failed",
		goodId = `10.1234/${name}`,
		cancelId = "10.1234/batch-cancel";
	let started = 0,
		releaseFirst: (() => void) | undefined,
		releaseCancelled: (() => void) | undefined;
	let aborted = false;
	const firstGate = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	page.on("requestfailed", (request) => {
		if (request.url().includes(encodeURIComponent(cancelId))) aborted = true;
	});
	await page.route("**/api/lookup?*", async (route) => {
		const id = new URL(route.request().url()).searchParams.get("q");
		started++;
		if (id === failedId) {
			await firstGate;
			await route.fulfill({ status: 404, json: { error: "paperNotFound" } });
			return;
		}
		if (id === goodId) releaseFirst?.();
		if (id === cancelId)
			await new Promise<void>((resolve) => {
				releaseCancelled = resolve;
			});
		await route
			.fulfill({
				json: {
					exact: true,
					papers: [
						{
							title: id === cancelId ? `${name}-cancelled` : name,
							doi: id,
							type: "doi",
						},
					],
				},
			})
			.catch(() => undefined);
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
	await page.getByRole("button", { name: "General", exact: true }).click();
	const translator = page.getByRole("textbox", {
		name: "Translator service URL",
		exact: true,
	});
	await translator.fill("");
	const saveTranslator = translator
		.locator("../../..")
		.getByRole("button", { name: "Save", exact: true });
	await saveTranslator.click();
	await expect(saveTranslator).toBeEnabled();
	await page
		.getByText("Background task concurrency", { exact: true })
		.locator("../..")
		.getByRole("combobox")
		.click();
	await page
		.getByRole("option", { name: "2 simultaneous", exact: true })
		.click();
	await page.keyboard.press("Escape");
	await page.locator("[data-magic-wand]").click();
	const input = page.getByPlaceholder(
		"arXiv / DOI, paper title, GitHub Skill URL…",
	);
	await input.fill(`${failedId}\n${goodId}`);
	await input.press("Enter");
	await expect.poll(() => started).toBe(2);
	await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(1);
	await expect(input).toBeEnabled();
	await input.fill(cancelId);
	await input.press("Enter");
	await expect.poll(() => started).toBe(3);
	const tasks = page.getByRole("region", {
		name: "Background Tasks",
		exact: true,
	});
	await tasks.hover();
	await tasks.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect.poll(() => aborted).toBe(true);
	releaseCancelled?.();
	await expect(input).toBeEnabled();
	expect(
		(
			await page.request.get(
				`/api/file?path=${encodeURIComponent(`papers/${name}-cancelled/.paper.json`)}`,
			)
		).status(),
	).toBe(404);
});
