import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("original Vault examples open in source editor and template seeding preserves offline edits", async ({
	page,
	context,
}) => {
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Local template edits only");
	test.setTimeout(180000);
	await page.goto("/?view=desktop");
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
	await page.keyboard.press("Control+p");
	await page
		.getByPlaceholder("Search papers, file paths, and note contents…")
		.fill("thesis/main.tex");
	await page
		.locator('[role="option"][data-value="hit:thesis/main.tex"]')
		.click();
	const editor = page
		.locator('.cm-editor .cm-content[contenteditable="true"]')
		.filter({ visible: true })
		.last();
	await expect(editor).toContainText("A Minimal Research Paper");
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	const marker = `User template edit ${Date.now()}`;
	await editor.click();
	await page.keyboard.press("Control+End");
	await page.keyboard.insertText(`\n% ${marker}`);
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const db = await new Promise<IDBDatabase>((resolve) => {
					const r = indexedDB.open("agentero-cloud-v1");
					r.onsuccess = () => resolve(r.result);
				});
				const file = await new Promise<{ data: Blob }>((resolve) => {
					const r = db
						.transaction("files")
						.objectStore("files")
						.get("thesis/main.tex");
					r.onsuccess = () => resolve(r.result);
				});
				db.close();
				return file.data.text();
			}),
		)
		.toContain(marker);
	await page.reload();
	await expect(
		page.locator(".cm-content").filter({ hasText: marker }).last(),
	).toBeVisible({ timeout: 45000 });
	await context.setOffline(false);
	await expect
		.poll(
			async () => {
				const r = await page.request.get("/api/file?path=thesis%2Fmain.tex");
				return r.ok() ? r.text() : "";
			},
			{ timeout: 30000 },
		)
		.toContain(marker);
	const guide = await page.request.get(
		`/api/file?path=${encodeURIComponent("notes/en/02 Agent and Skills.md")}`,
	);
	expect(guide.ok()).toBeTruthy();
	expect(await guide.text()).toContain("one built-in Agent");
});
