import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { finishInitialSetup } from "./setup";

test("original mobile library reads PDF, saves offline notes and retains concurrent edits", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Local test creates paper data",
	);
	test.setTimeout(240000);
	await page.setViewportSize({ width: 390, height: 844 });
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
	const title = `mobile-${Date.now()}`;
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	pdf
		.addPage()
		.drawText("Mobile original PDF reader", { x: 30, y: 700, font, size: 18 });
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
	await page.getByRole("button").filter({ hasText: title }).click();
	await expect(
		page.locator('img[src^="blob:"]').filter({ visible: true }).first(),
	).toBeVisible({ timeout: 90000 });
	// Opening the original reader automatically produces layout, without clicking Analysis.
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/file?path=${encodeURIComponent(`papers/${title}/source/layout.json`)}`,
				);
				return response.ok() ? (await response.json()).regions?.length : 0;
			},
			{ timeout: 90000 },
		)
		.toBeGreaterThan(0);
	await page.getByRole("button", { name: "Notes", exact: true }).click();
	const notes = page
		.getByRole("textbox", { name: "Notes", exact: true })
		.filter({ visible: true });
	await expect(notes).toBeEnabled();
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await notes.fill("# Mobile notes\n\nOffline author text.");
	await page
		.getByRole("button", { name: "Back to library", exact: true })
		.click();
	await expect(
		page.getByRole("textbox", { name: "Search papers", exact: true }),
	).toBeVisible();
	await page.reload();
	await page.getByRole("button").filter({ hasText: title }).click();
	await page.getByRole("button", { name: "Notes", exact: true }).click();
	await expect(notes).toHaveValue("# Mobile notes\n\nOffline author text.");
	await context.setOffline(false);
	const path = `papers/${title}/NOTES.md`;
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/file?path=${encodeURIComponent(path)}`,
				);
				return response.ok() ? response.text() : "";
			},
			{ timeout: 45000 },
		)
		.toContain("Offline author text.");
	// A second tab shares the device's IndexedDB but holds an independent editor snapshot.
	const other = await context.newPage();
	await other.setViewportSize({ width: 390, height: 844 });
	await other.goto("/?view=mobile");
	await other.getByRole("button").filter({ hasText: title }).click();
	await other.getByRole("button", { name: "Notes", exact: true }).click();
	const otherNotes = other
		.getByRole("textbox", { name: "Notes", exact: true })
		.filter({ visible: true });
	await expect(otherNotes).toHaveValue(
		"# Mobile notes\n\nOffline author text.",
	);
	await notes.fill("First editor changes");
	await page
		.getByRole("button", { name: "Save notes", exact: true })
		.filter({ visible: true })
		.click();
	await expect
		.poll(async () => {
			const response = await page.request.get(
				`/api/file?path=${encodeURIComponent(path)}`,
			);
			return response.text();
		})
		.toBe("First editor changes");
	await otherNotes.fill("Second editor changes");
	await other
		.getByRole("button", { name: "Save notes", exact: true })
		.filter({ visible: true })
		.click();
	await expect
		.poll(async () => {
			const response = await page.request.get(
				`/api/file?path=${encodeURIComponent(path)}`,
			);
			return response.text();
		})
		.toBe("Second editor changes");
	await expect
		.poll(
			async () => {
				let cursor = 0;
				do {
					const response = await page.request.get(
						`/api/changes?after=${cursor}`,
					);
					const data = await response.json();
					const conflict = data.files.find(
						(file: { path: string }) =>
							file.path.startsWith("Conflicts/editor-") &&
							file.path.endsWith(path),
					);
					if (conflict)
						return (
							await page.request.get(
								`/api/file?path=${encodeURIComponent(conflict.path)}`,
							)
						).text();
					if (!data.more) return "";
					cursor = data.cursor;
				} while (cursor);
				return "";
			},
			{ timeout: 30000 },
		)
		.toBe("First editor changes");
	await other.close();
	await page
		.getByRole("button", { name: "Back to library", exact: true })
		.click();
	await page.getByRole("button", { name: "Open menu", exact: true }).click();
	await page.getByRole("button", { name: "Agent", exact: true }).click();
	await expect(page.locator(".mobile-shell")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Open menu", exact: true }),
	).toBeVisible();
});
