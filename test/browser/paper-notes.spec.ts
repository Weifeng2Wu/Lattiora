import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { finishInitialSetup } from "./setup";

test.use({ actionTimeout: 20000 });

test("paper notes are discoverable in the tree and retain edits after an offline reload", async ({
	page,
	context,
}) => {
	const title = `note-location-${Date.now()}`;
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
	const pdf = await PDFDocument.create();
	pdf.addPage();
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
	const library = page.getByRole("treeitem", { name: "Library", exact: true });
	if ((await library.getAttribute("aria-expanded")) !== "true")
		await library.click();
	await page.getByRole("treeitem", { name: new RegExp(`^${title}`) }).click();
	const editor = page
		.locator('[contenteditable="true"][role="textbox"]')
		.first();
	await expect(editor).toBeVisible();
	await editor.click();
	await editor.press("Control+End");
	await editor.press("Enter");
	await editor.pressSequentially(
		"Saved beside the paper, visible in the tree.",
	);
	await editor.press("Control+s");
	const read = () =>
		page.evaluate(async (path) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("agentero-cloud-v1");
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			const record = await new Promise<{ data: Blob } | undefined>(
				(resolve) => {
					const req = db.transaction("files").objectStore("files").get(path);
					req.onsuccess = () => resolve(req.result);
				},
			);
			db.close();
			return record?.data.text();
		}, `papers/${title}/NOTES.md`);
	await expect.poll(read).toContain("Saved beside the paper");
	// Opening the notes panel reveals its real file rather than hiding it under the paper.
	const note = page.getByRole("treeitem", { name: "NOTES", exact: true });
	await expect(note).toBeVisible();
	await note.click();
	await expect(editor).toContainText("Saved beside the paper");
	await expect
		.poll(
			() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
			{ timeout: 90000 },
		)
		.toBe(true);
	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole("tree")).toBeVisible();
	await page.keyboard.press("Control+p");
	await page
		.getByPlaceholder("Search papers, file paths, and note contents…")
		.fill(`${title}/NOTES.md`);
	await page.getByRole("option").filter({ hasText: title }).first().click();
	await expect(editor).toContainText("Saved beside the paper");
	await expect(note).toBeVisible();
});
