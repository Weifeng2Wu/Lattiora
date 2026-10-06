import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { finishInitialSetup } from "./setup";

test("original local layout model runs real ONNX inference and reloads offline", async ({
	page,
	context,
}) => {
	test.setTimeout(360000);
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
	const settings = async () => {
		await page
			.getByRole("toolbar", { name: "Workspace storage" })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		await page.getByRole("button", { name: "Layout", exact: true }).click();
	};
	await settings();
	await page
		.getByRole("button", { name: "Download and test", exact: true })
		.click();
	await expect(
		page.getByRole("status").filter({ hasText: "Inference test passed" }),
	).toBeVisible({ timeout: 240000 });
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({
		timeout: 90000,
	});
	await context.setOffline(true);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible();
	await settings();
	await page.getByRole("button", { name: "Test model", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Inference test passed" }),
	).toBeVisible({ timeout: 120000 });
	await page.getByRole("button", { name: "Close", exact: true }).click();
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const sheet = pdf.addPage([595, 842]);
	sheet.drawText("Research on offline scientific workspaces", {
		x: 40,
		y: 760,
		size: 19,
		font,
	});
	for (let i = 0; i < 18; i++)
		sheet.drawText(
			"Local document storage preserves scientific notes and annotations.",
			{ x: 40, y: 705 - i * 18, size: 12, font },
		);
	const title = `onnx-layout-${Date.now()}`;
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const picker = page.waitForEvent("filechooser");
	await page
		.getByRole("menuitem", { name: "Import PDF to library", exact: true })
		.click();
	await (await picker).setFiles({
		name: `${title}.pdf`,
		mimeType: "application/pdf",
		buffer: Buffer.from(await pdf.save()),
	});
	await page.getByRole("row").filter({ hasText: title }).click();
	const analysis = page.getByRole("button", { name: "Analysis", exact: true });
	await expect(analysis).toBeVisible();
	const rect = await analysis.boundingBox();
	if (rect)
		await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
	await analysis.click();
	await page
		.getByRole("button", {
			name: /^(Extract PDF text|Detect figures, tables, and formulas)$/,
		})
		.last()
		.click();
	await expect
		.poll(
			async () =>
				page.evaluate(async (title) => {
					const db = await new Promise<IDBDatabase>((resolve, reject) => {
						const req = indexedDB.open("agentero-cloud-v1", 1);
						req.onsuccess = () => resolve(req.result);
						req.onerror = () => reject(req.error);
					});
					const file = await new Promise<{ data: Blob } | undefined>(
						(resolve) => {
							const req = db
								.transaction("files")
								.objectStore("files")
								.get(`papers/${title}/source/layout.json`);
							req.onsuccess = () => resolve(req.result);
						},
					);
					db.close();
					if (!file) return false;
					const layout = JSON.parse(await file.data.text());
					return (
						layout.source.mode === "embedpdf-layout" &&
						layout.regions.length > 0 &&
						layout.regions.some((region: { text?: string }) =>
							region.text?.includes("scientific"),
						)
					);
				}, title),
			{ timeout: 120000 },
		)
		.toBe(true);
});
