import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("original Library heatmap follows synced marks, offline reload and deletion", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Uses an isolated local library fixture.",
	);
	test.setTimeout(180000);
	const title = `heatmap-${Date.now()}`;
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
		name: "heatmap.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify([{ title }])),
	});
	const row = page.getByRole("row").filter({ hasText: title });
	await expect(row).toBeVisible();
	const path = `papers/${title}/marks/heat.json`,
		base = new URL(page.url()).origin;
	const write = async (deleted: boolean, version: number) => {
		const response = await page.request.put("/api/file", {
			headers: { origin: base },
			data: {
				path,
				version,
				mutation_id: crypto.randomUUID(),
				deleted,
				mime: "application/json",
				blob_key: null,
				content: deleted
					? null
					: JSON.stringify({
							version: 1,
							id: "heat",
							paperPath: `/cloud/papers/${title}`,
							kind: "ask",
							createdAt: "2026-09-30",
							updatedAt: "2026-09-30",
							status: "open",
							anchor: {
								page: 3,
								rects: [{ x: 0.1, y: 0.2, w: 0.4, h: 0.1 }],
								trigger: "selection",
							},
							messages: [
								{
									id: "q",
									role: "user",
									content: "Explain",
									createdAt: "2026-09-30",
								},
								{
									id: "a",
									role: "assistant",
									content: "Answer",
									createdAt: "2026-09-30",
								},
							],
						}),
			},
		});
		expect(response.ok()).toBe(true);
	};
	await write(false, 0);
	await page.mouse.move(300, 500);
	await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
		timeout: 15000,
	});
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	const heat = row.locator('span[style*="linear-gradient"]');
	await expect(heat).toHaveCount(1, { timeout: 30000 });
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await page.reload();
	await expect(heat).toHaveCount(1, { timeout: 45000 });
	await write(true, 1);
	await context.setOffline(false);
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect(heat).toHaveCount(0, { timeout: 30000 });
});
