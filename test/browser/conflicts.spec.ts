import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("conflicts stay out of the workspace and are resolved in sync settings", async ({
	page,
}) => {
	test.setTimeout(180000);
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Creates conflict fixtures in the local Worker",
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
	const prefix = `conflict-review-${Date.now()}`;
	const original = `notes/${prefix}.md`;
	const recovered = `Conflicts/${prefix}/${original}`;
	const identical = `notes/${prefix}-identical.md`;
	const identicalCopy = `Conflicts/${prefix}/${identical}`;
	const base = new URL(page.url()).origin;
	for (const [path, content] of [
		[original, "Title\nCurrent version\nEnd\n"],
		[recovered, "Title\nRecovered version\nEnd\n"],
		[identical, "Unchanged content\n"],
		[identicalCopy, "Unchanged content\n"],
	]) {
		const result = await page.request.put("/api/file", {
			headers: { origin: base },
			data: {
				path,
				version: 0,
				mutation_id: crypto.randomUUID(),
				deleted: false,
				mime: "text/markdown",
				blob_key: null,
				content,
			},
		});
		expect(result.ok()).toBe(true);
	}
	const sync = page.getByRole("button", { name: "Sync now", exact: true });
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await sync.click();
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await expect(
		page.getByRole("treeitem", { name: "Conflicts", exact: true }),
	).toHaveCount(0);
	await page.keyboard.press("Control+p");
	await page
		.getByPlaceholder("Search papers, file paths, and note contents…")
		.fill(prefix);
	await expect(
		page.getByRole("option").filter({ hasText: `${prefix}.md` }),
	).toHaveCount(1);
	await page.keyboard.press("Escape");
	await page
		.getByRole("toolbar", { name: "Workspace storage" })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Sync", exact: true }).click();
	await page.getByRole("button", { name: "Review", exact: true }).click();
	const dialog = page.getByRole("dialog", {
		name: "Resolve conflicts",
		exact: true,
	});
	await expect(
		dialog.getByRole("button", { name: identical, exact: true }),
	).toBeVisible();
	await page.context().setOffline(true);
	await dialog
		.getByRole("button", { name: "Resolve identical copies", exact: true })
		.click();
	await expect(dialog.getByRole("status")).toHaveText(
		"Resolved 1 · Left for review 1",
	);
	await expect(
		dialog.getByRole("button", { name: identical, exact: true }),
	).toHaveCount(0);
	await expect(
		dialog.getByRole("button", { name: original, exact: true }),
	).toBeVisible();
	await page.context().setOffline(false);
	await dialog.getByRole("button", { name: original, exact: true }).click();
	await expect(dialog).toContainText("Recovered version");
	await expect(dialog).toContainText("Current version");
	await dialog
		.getByRole("button", { name: "Use other version", exact: true })
		.click();
	await expect(
		dialog.getByRole("button", { name: original, exact: true }),
	).toHaveCount(0);
	await page.screenshot({
		path: test.info().outputPath("conflicts-settings.png"),
	});
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await sync.click();
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/file?path=${encodeURIComponent(original)}`,
				);
				return response.text();
			},
			{ timeout: 60000 },
		)
		.toContain("Recovered version");
	await expect(
		page.getByRole("treeitem", { name: "Conflicts", exact: true }),
	).toHaveCount(0);
	await expect
		.poll(
			async () =>
				(
					await page.request.get(
						`/api/file?path=${encodeURIComponent(identicalCopy)}`,
					)
				).status(),
			{ timeout: 60000 },
		)
		.toBe(404);
	expect(
		await (
			await page.request.get(`/api/file?path=${encodeURIComponent(identical)}`)
		).text(),
	).toBe("Unchanged content\n");
});
