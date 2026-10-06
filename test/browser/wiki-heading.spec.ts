import { expect, type Page, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

async function readFiles(page: Page, prefix: string) {
	return page.evaluate(async (prefix) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open("agentero-cloud-v1", 1);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const records = await new Promise<
			Array<{
				path: string;
				data: Blob | null;
				dirty: boolean;
				deleted: number;
			}>
		>((resolve) => {
			const req = db.transaction("files").objectStore("files").getAll();
			req.onsuccess = () => resolve(req.result);
		});
		db.close();
		return Promise.all(
			records
				.filter(
					(file) => file.path.startsWith(`notes/${prefix}`) && !file.deleted,
				)
				.map(async (file) => ({
					path: file.path,
					text: await file.data?.text(),
					dirty: file.dirty,
				})),
		);
	}, prefix);
}
test("original editor renames a saved heading and inbound links offline, then syncs both files", async ({
	page,
	context,
}) => {
	test.setTimeout(240000);
	const prefix =
		process.env.AGENTERO_HEADING_TEST_PREFIX ?? `Heading-${Date.now()}`;
	const target = `${prefix}-Target.md`,
		source = `${prefix}-Source.md`;
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
		.getByRole("menuitem", { name: "Import files to notes", exact: true })
		.click();
	await (await picker).setFiles([
		{
			name: target,
			mimeType: "text/markdown",
			buffer: Buffer.from("# Parent\n\n## Old\n\nBody.\n"),
		},
		{
			name: source,
			mimeType: "text/markdown",
			buffer: Buffer.from(
				`[[${target.slice(0, -3)}#Parent#Old|Preserved alias]]\n`,
			),
		},
	]);
	await expect.poll(async () => (await readFiles(page, prefix)).length).toBe(2);
	const sidebar = page.locator("[data-vault-sidebar]");
	const folder = sidebar.getByRole("treeitem", { name: "notes", exact: true });
	if ((await folder.getAttribute("aria-expanded")) !== "true")
		await folder.click();
	const scroll = sidebar
		.locator(".agentero-scroll")
		.filter({ has: page.getByRole("tree") })
		.last();
	const row = sidebar.getByText(target, { exact: true });
	await scroll.evaluate((element) => {
		element.scrollTop = 0;
	});
	await expect
		.poll(async () => {
			if (await row.count()) return true;
			await scroll.evaluate((element) =>
				element.scrollBy(0, element.clientHeight * 0.7),
			);
			return false;
		})
		.toBe(true);
	await row.click();
	const heading = page
		.locator('[contenteditable="true"][role="textbox"]')
		.getByRole("heading", { name: "Old", exact: true });
	await expect(heading).toBeVisible();
	await expect(
		page
			.getByRole("toolbar", { name: "Workspace storage" })
			.getByRole("status"),
	).toContainText("Offline ready", { timeout: 120000 });
	await context.setOffline(true);
	await heading.click();
	await heading.click({ button: "right" });
	await page
		.getByRole("menuitem", { name: "Rename current heading", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Rename current heading",
		exact: true,
	});
	await dialog.getByLabel("Heading", { exact: true }).fill("Renamed");
	await dialog.getByRole("button", { name: "Rename", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect
		.poll(
			async () =>
				(await readFiles(page, prefix)).find((file) =>
					file.path.endsWith(target),
				)?.text,
		)
		.toContain("## Renamed");
	const expected = `[[${target.slice(0, -3)}#Parent#Renamed|Preserved alias]]\n`;
	await expect
		.poll(
			async () =>
				(await readFiles(page, prefix)).find((file) =>
					file.path.endsWith(source),
				)?.text,
		)
		.toBe(expected);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible();
	expect(
		(await readFiles(page, prefix)).find((file) => file.path.endsWith(source))
			?.text,
	).toBe(expected);
	await context.setOffline(false);
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect
		.poll(
			async () => (await readFiles(page, prefix)).every((file) => !file.dirty),
			{ timeout: 60000 },
		)
		.toBe(true);
});
