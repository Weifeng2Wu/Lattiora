import { expect, test } from "@playwright/test";
import { disableTranslator, finishInitialSetup } from "./setup";

test("original citing dialog tests configured service, selects imports and reopens offline", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Local isolated provider fixture",
	);
	test.setTimeout(180000);
	const title = `citing-seed-${Date.now()}`,
		candidate = `citing-result-${Date.now()}`;
	const candidateDoi = `10.1234/${candidate}`;
	const seedId = "a".repeat(40),
		candidateId = "b".repeat(40);
	let probes = 0;
	await page.route("**/api/citing", async (route) => {
		const input = route.request().postDataJSON();
		if (input.operation === "probe") {
			probes++;
			await route.fulfill({ json: { ok: true } });
			return;
		}
		if (input.operation === "batch") {
			await route.fulfill({
				json: input.ids.map((id: string) =>
					id === candidateId
						? { paperId: candidateId }
						: { paperId: seedId, citationCount: 1 },
				),
			});
			return;
		}
		await route.fulfill({
			json: {
				data: [
					{
						citingPaper: {
							paperId: candidateId,
							title: candidate,
							publicationDate: new Date().toISOString().slice(0, 10),
							externalIds: { DOI: candidateDoi },
						},
					},
				],
			},
		});
	});
	await page.route("**/api/lookup?*", async (route) =>
		route.fulfill({
			json: {
				exact: true,
				papers: [
					{
						title: candidate,
						doi: candidateDoi,
						authors: ["Researcher"],
						year: 2026,
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
		name: "seed.json",
		mimeType: "application/json",
		buffer: Buffer.from(
			JSON.stringify([{ title, doi: "10.1234/citing-seed" }]),
		),
	});
	await page
		.getByRole("toolbar", { name: "Workspace storage" })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "General", exact: true }).click();
	await disableTranslator(page, true);
	await page
		.getByLabel("Semantic Scholar Graph API URL", { exact: true })
		.fill(`https://s2.example/graph/${candidate}`);
	const group = page
		.getByLabel("Semantic Scholar Graph API URL", { exact: true })
		.locator("xpath=ancestor::*[.//button[normalize-space()='Save']][1]");
	await group
		.getByRole("button", { name: "Test connection", exact: true })
		.click();
	await expect.poll(() => probes).toBe(1);
	await group.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		page.getByText("Citation service saved", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Close", exact: true }).click();
	const discover = async () => {
		await page
			.getByRole("treeitem", { name: "Library", exact: true })
			.click({ button: "right" });
		await page
			.getByRole("menuitem", { name: "Find citing papers", exact: true })
			.click({ timeout: 20000 });
	};
	await discover();
	const dialog = page.getByRole("dialog", {
		name: "New papers citing your library",
	});
	await expect(dialog.getByText(candidate, { exact: true })).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Import 0", exact: true }),
	).toBeDisabled();
	await dialog.getByRole("checkbox").check();
	await expect(
		dialog.getByRole("button", { name: "Import 1", exact: true }),
	).toBeEnabled();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await page.reload();
	await discover();
	await expect(dialog.getByText(candidate, { exact: true })).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Import 0", exact: true }),
	).toBeDisabled();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await context.setOffline(false);
	await discover();
	await dialog.getByRole("checkbox").check();
	await dialog.getByRole("button", { name: "Import 1", exact: true }).click();
	await expect(
		page.getByRole("row").filter({ hasText: candidate }),
	).toBeVisible({ timeout: 30000 });
});
