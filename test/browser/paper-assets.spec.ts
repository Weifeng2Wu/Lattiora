import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { finishInitialSetup } from "./setup";

test("original bulk asset action downloads PDF and TeX, preserves edits and survives offline reload", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Isolated library and upstream fixture",
	);
	test.setTimeout(180000);
	const title = `assets-${Date.now()}`;
	const arxivId = `2609.${String(Date.now() % 100000).padStart(5, "0")}`;
	const pdf = await PDFDocument.create();
	pdf.addPage();
	const bytes = Buffer.from(await pdf.save());
	let sourceCalls = 0;
	await page.route("**/api/remote-pdf?*", (route) =>
		route.fulfill({ body: bytes, contentType: "application/pdf" }),
	);
	await page.route("**/api/arxiv-source?*", (route) => {
		sourceCalls++;
		return route.fulfill({
			body: "\\documentclass{article}\n\\begin{document}\nOriginal source\n\\end{document}",
			contentType: "application/octet-stream",
		});
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
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const chooser = page.waitForEvent("filechooser");
	await page
		.getByRole("menuitem", { name: "Import BibTeX / RIS / JSON", exact: true })
		.click();
	await (await chooser).setFiles({
		name: "assets.json",
		mimeType: "application/json",
		buffer: Buffer.from(
			JSON.stringify([
				{
					title,
					arxiv_id: arxivId,
					pdf_url: "https://arxiv.org/pdf/2501.00001",
				},
			]),
		),
	});
	const run = async () => {
		await page
			.getByRole("treeitem", { name: "Library", exact: true })
			.click({ button: "right" });
		await page
			.getByRole("menuitem", {
				name: "Download all incomplete paper assets",
				exact: true,
			})
			.click();
	};
	await run();
	await expect.poll(() => sourceCalls).toBeGreaterThan(0);
	const localFiles = () =>
		page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("agentero-cloud-v1");
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			const files = await new Promise<
				Array<{ path: string; data: Blob; deleted: number }>
			>((resolve, reject) => {
				const req = db.transaction("files").objectStore("files").getAll();
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			db.close();
			return files.filter((f) => !f.deleted).map((f) => f.path);
		});
	await expect.poll(localFiles).toContain(`papers/${arxivId}/source/main.tex`);
	await expect.poll(localFiles).toContain(`papers/${arxivId}/paper.pdf`);
	const before = sourceCalls;
	await page
		.getByRole("treeitem", { name: "Library", exact: true })
		.click({ button: "right" });
	await expect(
		page.getByRole("menuitem", {
			name: "Download all incomplete paper assets",
			exact: true,
		}),
	).toHaveCount(0);
	await expect(
		page.getByRole("menuitem", { name: "Export library", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(500);
	expect(sourceCalls).toBe(before);
	// Original paper tree intentionally surfaces attachments only. Quick Open
	// provides browser access to downloaded source paths without a native file manager.
	await page.keyboard.press("Control+p");
	await page
		.getByPlaceholder("Search papers, file paths, and note contents…")
		.fill(`${arxivId}/source/main.tex`);
	await page
		.getByRole("option")
		.filter({ hasText: "main.tex" })
		.click({ timeout: 20000 });
	const editor = page
		.locator('.cm-editor .cm-content[contenteditable="true"]')
		.filter({ visible: true })
		.last();
	await expect(editor).toContainText("Original source");
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await editor.click();
	await page.keyboard.press("Control+End");
	await page.keyboard.insertText("\n% Offline editable source");
	await expect
		.poll(() =>
			page.evaluate(async (path) => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open("agentero-cloud-v1");
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				const file = await new Promise<{ data: Blob } | undefined>(
					(resolve, reject) => {
						const request = db
							.transaction("files")
							.objectStore("files")
							.get(path);
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					},
				);
				db.close();
				return file?.data.text();
			}, `papers/${arxivId}/source/main.tex`),
		)
		.toContain("Offline editable source");
	await page.reload();
	await expect(
		page
			.locator(".cm-content")
			.filter({ hasText: "Offline editable source" })
			.last(),
	).toBeVisible({ timeout: 45000 });
	await context.setOffline(false);
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect
		.poll(async () => {
			const response = await page.request.get(
				`/api/file?path=${encodeURIComponent(`papers/${arxivId}/source/main.tex`)}`,
			);
			return response.ok() ? response.text() : "";
		})
		.toContain("Offline editable source");
});
