import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { finishInitialSetup } from "./setup";

test("original References panel parses ordered source files, imports a citation and reads offline", async ({
	page,
	context,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Uses isolated local bibliography fixtures.",
	);
	test.setTimeout(240000);
	const suffix = Date.now(),
		title = `references-${suffix}`,
		citedTitle = `Referenced scientific work ${suffix}`;
	await page.route("**/api/lookup?*", (route) =>
		route.fulfill({
			json: {
				exact: true,
				papers: [
					{
						title: citedTitle,
						doi: `10.1234/ref${suffix}`,
						authors: ["Researcher"],
						abstract: "A reference imported through the original panel.",
					},
				],
			},
		}),
	);
	await page.route("**/api/references", (route) =>
		route.fulfill({ json: { source: "crossref", citations: [] } }),
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
	const pdf = await PDFDocument.create(),
		font = await pdf.embedFont(StandardFonts.Helvetica);
	pdf.addPage().drawText("Scientific paper with references [1].", {
		x: 40,
		y: 700,
		font,
		size: 14,
	});
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
	const base = new URL(page.url()).origin;
	for (const [name, content] of [
		[
			"refs.bbl",
			String.raw`\begin{thebibliography}{1}\bibitem{target} Researcher. ${citedTitle}. 2026.\end{thebibliography}`,
		],
		[
			"refs.bib",
			`@article{target,title={${citedTitle}},author={Researcher},year={2026},doi={10.1234/ref${suffix}}}`,
		],
	]) {
		const response = await page.request.put("/api/file", {
			headers: { origin: base },
			data: {
				path: `papers/${title}/source/${name}`,
				version: 0,
				mutation_id: crypto.randomUUID(),
				deleted: false,
				content,
				blob_key: null,
				mime: "text/plain",
			},
		});
		expect(response.ok()).toBe(true);
	}
	await page.mouse.move(300, 500);
	await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
		timeout: 15000,
	});
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await page.getByRole("row").filter({ hasText: title }).click();
	const button = page.getByRole("button", { name: "References", exact: true });
	await expect(button).toBeVisible();
	const rect = await button.boundingBox();
	if (rect)
		await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
	await button.click();
	const panel = page.getByRole("region", { name: "References of this paper" });
	await expect(panel.getByText(citedTitle, { exact: true })).toBeVisible({
		timeout: 45000,
	});
	await panel
		.getByRole("button", { name: "Import into library", exact: true })
		.click();
	await page
		.getByRole("button", { name: "papers", exact: true })
		.last()
		.click();
	await expect(
		panel.getByRole("img", { name: "In library", exact: true }),
	).toBeVisible({ timeout: 45000 });
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await page.reload();
	await expect(button).toBeVisible({ timeout: 45000 });
	if ((await button.getAttribute("aria-pressed")) !== "true") {
		const rect = await button.boundingBox();
		if (rect)
			await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
		await button.click();
	}
	await expect(panel.getByText(citedTitle, { exact: true })).toBeVisible();
	await expect(
		panel.getByRole("img", { name: "In library", exact: true }),
	).toBeVisible();
	await context.setOffline(false);
	await page.mouse.move(300, 500);
	await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
		timeout: 15000,
	});
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect
		.poll(async () => {
			const response = await page.request.get(
				`/api/file?path=${encodeURIComponent(`papers/${title}/source/agentero-cite.json`)}`,
			);
			if (!response.ok()) return false;
			const value = await response.json();
			const imported = await page.request.get(
				`/api/file?path=${encodeURIComponent(`papers/${citedTitle}/.paper.json`)}`,
			);
			return (
				value.citations[0]?.metadata?.doi === `10.1234/ref${suffix}` &&
				imported.ok() &&
				(await imported.json()).title === citedTitle
			);
		})
		.toBe(true);
});
