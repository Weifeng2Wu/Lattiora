import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { finishInitialSetup } from "./setup";

test("original PDF import resumes recognition after offline reload and synchronizes metadata", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Local recognition fixture only",
	);
	test.setTimeout(180000);
	const title = `recognition-${Date.now()}`,
		recognized = `${title} identified`;
	const doi = `10.1234/${title}`,
		canonical = `10_1234_${title}`;
	await page.route("**/api/lookup?*", (route) =>
		route.fulfill({
			json: {
				exact: true,
				papers: [
					{ title: recognized, doi, authors: ["Researcher"], year: 2026 },
				],
			},
		}),
	);
	await page.route("**/api/translator", (route) =>
		route.fulfill({
			json: {
				exact: true,
				papers: [
					{ title: recognized, doi, authors: ["Researcher"], year: 2026 },
				],
			},
		}),
	);
	let probes = 0,
		recognitions = 0;
	await page.route("**/api/recognize", async (route) => {
		const input = route.request().postDataJSON();
		if (input.operation === "probe") {
			probes++;
			await route.fulfill({ json: { ok: true } });
			return;
		}
		recognitions++;
		expect(input.baseUrl).toBe(
			"https://services.zotero.org/recognizer/recognize",
		);
		expect(input.payload.totalPages).toBe(1);
		expect(typeof input.payload.pages[0][2][0][0][0][4][0][0][0][13]).toBe(
			"string",
		);
		expect(JSON.stringify(input.payload.pages)).toContain(
			"Recognition browser test",
		);
		await route.fulfill({
			json: {
				title: recognized,
				doi,
				authors: [{ name: "Researcher" }],
				year: "2026",
			},
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
	await page
		.getByRole("toolbar", { name: "Workspace storage" })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "General", exact: true }).click();
	const endpoint = page.getByLabel("Recognition endpoint", { exact: true });
	await expect(endpoint).toHaveValue(
		"https://services.zotero.org/recognizer/recognize",
	);
	await expect(
		page.getByRole("switch", {
			name: "Enable PDF metadata recognition",
			exact: true,
		}),
	).toBeChecked();
	const group = endpoint.locator(
		"xpath=ancestor::*[.//button[normalize-space()='Save']][1]",
	);
	await group
		.getByRole("button", { name: "Test connection", exact: true })
		.click();
	await expect.poll(() => probes).toBe(1);
	await group.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		page.getByText("Recognition service saved", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	const pdf = await PDFDocument.create(),
		font = await pdf.embedFont(StandardFonts.Helvetica);
	pdf.addPage().drawText("Recognition browser test with extractable text.", {
		x: 40,
		y: 700,
		font,
		size: 14,
	});
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
	await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
	expect(recognitions).toBe(0);
	await page.reload();
	await expect(page.getByText(title, { exact: true }).first()).toBeVisible({
		timeout: 45000,
	});
	await context.setOffline(false);
	await expect(page.getByText(recognized, { exact: true }).first()).toBeVisible(
		{ timeout: 90000 },
	);
	expect(recognitions).toBe(1);
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/file?path=${encodeURIComponent(`papers/${canonical}/.paper.json`)}`,
				);
				return response.ok() ? (await response.json()).title : "";
			},
			{ timeout: 30000 },
		)
		.toBe(recognized);
	// Disable fixture provider after this test so other PDF tests do not call it.
	await page
		.getByRole("toolbar", { name: "Workspace storage" })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "General", exact: true }).click();
	await page
		.getByRole("switch", {
			name: "Enable PDF metadata recognition",
			exact: true,
		})
		.uncheck();
	await group.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		page.getByText("Recognition service saved", { exact: true }),
	).toBeVisible();
});
