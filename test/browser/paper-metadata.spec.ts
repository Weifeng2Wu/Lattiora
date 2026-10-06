import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("original metadata editor preserves aliases offline and header refresh updates the paper", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Local library and lookup fixture",
	);
	test.setTimeout(180000);
	const title = `metadata-${Date.now()}`,
		manual = `${title} edited`,
		remote = `${title} refreshed`,
		doi = `10.1234/${title}`;
	await page.route("**/api/lookup?*", (route) =>
		route.fulfill({
			json:
				new URL(route.request().url()).searchParams.get("q") === doi
					? {
							exact: true,
							papers: [{ title: remote, doi, authors: ["Researcher"] }],
						}
					: { exact: false, papers: [] },
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
	const chooser = page.waitForEvent("filechooser");
	await page
		.getByRole("menuitem", { name: "Import BibTeX / RIS / JSON", exact: true })
		.click();
	await (await chooser).setFiles({
		name: "metadata.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify([{ title, doi }])),
	});
	const state = () =>
		page.evaluate(async (path) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open("agentero-cloud-v1");
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const entries = await new Promise<
				Array<{ path: string; data: Blob; deleted: number }>
			>((resolve, reject) => {
				const request = db.transaction("files").objectStore("files").getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			db.close();
			const meta = entries.find(
					(f) => f.path === `${path}/.paper.json` && !f.deleted,
				),
				notes = entries.find(
					(f) => f.path === `${path}/NOTES.md` && !f.deleted,
				);
			return {
				meta: meta ? JSON.parse(await meta.data.text()) : null,
				notes: notes ? await notes.data.text() : "",
			};
		}, `papers/${title}`);
	await expect.poll(async () => (await state()).meta?.title).toBe(title);
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await page
		.getByRole("treeitem")
		.filter({ hasText: title })
		.first()
		.click({ button: "right" });
	await page
		.getByRole("menuitem", { name: "Edit metadata", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Edit metadata",
		exact: true,
	});
	await dialog.getByLabel("Title", { exact: true }).fill(manual);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect.poll(async () => (await state()).meta?.title).toBe(manual);
	const edited = await state();
	expect(edited.notes).toContain(title);
	expect(edited.notes).toContain(manual);
	await page.reload();
	await expect(
		page.getByRole("treeitem").filter({ hasText: manual }),
	).toBeVisible({ timeout: 45000 });
	await context.setOffline(false);
	await page.getByRole("treeitem", { name: "Library", exact: true }).click();
	await page
		.getByRole("button", { name: "Refresh metadata", exact: true })
		.click();
	await expect
		.poll(async () => (await state()).meta?.title, { timeout: 30000 })
		.toBe(remote);
	expect((await state()).notes).toContain(manual);
	expect((await state()).notes).toContain(remote);
	await expect
		.poll(async () => {
			const response = await page.request.get(
				`/api/file?path=${encodeURIComponent(`papers/${title}/NOTES.md`)}`,
			);
			return response.ok() ? response.text() : "";
		})
		.toContain(remote);
});
