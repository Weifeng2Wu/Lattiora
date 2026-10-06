import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("TeX preview follows the live buffer and works offline without changing source", async ({
	page,
	context,
}) => {
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Local source edits only");
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
		.locator('.cm-content[contenteditable="true"]')
		.filter({ visible: true })
		.last();
	await expect(editor).toContainText("A Minimal Research Paper");
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await context.setOffline(true);
	await editor.click();
	const toggle = page.getByRole("button", {
		name: "LaTeX live preview",
		exact: true,
	});
	await toggle.click();
	const preview = page.getByRole("region", {
		name: "LaTeX live preview",
		exact: true,
	});
	await expect(
		preview.getByRole("heading", { name: "A Minimal Research Paper" }),
	).toBeVisible();
	await expect(preview.locator(".katex")).toHaveCount(1);
	await expect(preview.locator(".tex-footnotes")).toContainText("Affiliation.");
	await expect(preview.locator(".tex-bibliography")).toContainText(
		"Attention is all you need.",
	);
	await expect(preview.locator(".tex-reference")).toHaveText(["[1]", "(1)"]);
	await expect(preview).not.toContainText(String.raw`\thanks`);
	await page.screenshot({ path: "test-results/tex-thesis-preview.png" });

	const source = String.raw`\section{Live offline draft}
Body with \textbf{bold text} and $x^2$.
\begin{equation}\frac{1}{2}\end{equation}
\input{unsupported-file}
<img src=x onerror=alert(1)>`;
	await editor.click();
	await page.keyboard.press("Control+a");
	await page.keyboard.insertText(source);
	await expect(
		preview.getByRole("heading", { name: "1 Live offline draft" }),
	).toBeVisible();
	await expect(preview.locator("strong")).toHaveText("bold text");
	await expect(preview.locator(".katex")).toHaveCount(2);
	await expect(preview).toContainText(String.raw`\input{unsupported-file}`);
	await expect(preview.locator("img")).toHaveCount(0);
	await page.keyboard.press("Control+End");
	await page.keyboard.insertText("\n$unfinished");
	await expect(preview).toContainText("$unfinished");
	await page.keyboard.insertText("$");
	await expect(preview.locator(".katex")).toHaveCount(3);
	await toggle.click();
	await expect(preview).toHaveCount(0);
	await toggle.click();
	await expect(preview.locator(".katex")).toHaveCount(3);

	const savedSource = `${source}\n$unfinished$`;
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const db = await new Promise<IDBDatabase>((resolve) => {
					const request = indexedDB.open("agentero-cloud-v1");
					request.onsuccess = () => resolve(request.result);
				});
				const data = await new Promise<{ data: Blob }>((resolve) => {
					const request = db
						.transaction("files")
						.objectStore("files")
						.get("thesis/main.tex");
					request.onsuccess = () => resolve(request.result);
				});
				db.close();
				return data.data.text();
			}),
		)
		.toBe(savedSource);
	await page.screenshot({ path: "test-results/tex-preview-desktop.png" });
	await page.reload();
	await expect(editor).toContainText("Live offline draft", { timeout: 45000 });
	await editor.click();
	await toggle.click();
	await expect(preview.locator(".katex")).toHaveCount(3);
	await page.setViewportSize({ width: 760, height: 900 });
	const sourceBounds = await editor.boundingBox();
	const previewBounds = await preview.boundingBox();
	expect(sourceBounds).not.toBeNull();
	expect(previewBounds).not.toBeNull();
	expect(previewBounds?.y).toBeGreaterThan(sourceBounds?.y ?? 0);
	await page.screenshot({ path: "test-results/tex-preview-narrow.png" });
});
