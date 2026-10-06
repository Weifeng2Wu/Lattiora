import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("rendered note shares include only selected linked notes and disappear from management when closed", async ({
	page,
	browser,
	context,
}) => {
	test.setTimeout(240000);
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Creates local share fixtures");
	await page.goto("/");
	await page
		.getByLabel("Access password")
		.fill(
			process.env.AGENTERO_TEST_PASSWORD ??
				"local-development-password-32-chars",
		);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	const toolbar = page.getByRole("toolbar", { name: "Workspace storage" });
	await expect(toolbar).toBeVisible({ timeout: 90000 });
	await finishInitialSetup(page, { stayOnHome: true });
	const home = page.getByRole("region", { name: "Home", exact: true });
	await home
		.getByRole("button", { name: "Back to workspace", exact: true })
		.click();
	await expect(home).toHaveCount(0);
	await toolbar.getByRole("button", { name: "Home", exact: true }).click();
	await expect(home).toBeVisible();
	await home
		.getByRole("button", { name: "Back to workspace", exact: true })
		.click();
	const name = `share-${Date.now()}`;
	const origin = new URL(page.url()).origin;
	const source = `---\nprivate: never-share-frontmatter\n---\n# ${name}\n\nSnapshot content with $x^2$.\n\n## Results\n\n| Method | Score |\n| --- | --- |\n| Ours | 42 |\n\n\`\`\`python\nprint("safe code")\n\`\`\`\n\n[[${name}-a|Read selected note]]\n\n[Read excluded note](${name}-b.md)\n\n![Private image](/api/file?path=private.png)\n\n<script>window.evil = true</script>`;
	const fixtures = [
		[`notes/${name}.md`, source],
		[
			`notes/${name}-a.md`,
			`---\nprivate: never-share-child-frontmatter\n---\n# Selected note\n\nSelected note body. [[${name}|Back to root]] [[${name}-secret|Indirect note]]`,
		],
		[`notes/${name}-b.md`, "# Excluded note\n\nExcluded note private body."],
		[`notes/${name}-secret.md`, "# Indirect secret\n\nIndirect private body."],
	];
	for (const [path, content] of fixtures) {
		expect(
			(
				await page.request.put("/api/file", {
					headers: { origin },
					data: {
						path,
						version: 0,
						mutation_id: crypto.randomUUID(),
						deleted: false,
						mime: "text/markdown",
						blob_key: null,
						content,
					},
				})
			).ok(),
		).toBe(true);
	}
	const sync = toolbar.getByRole("button", { name: "Sync now", exact: true });
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await sync.click();
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await expect(toolbar).toContainText("Offline ready", { timeout: 90000 });
	await page.keyboard.press("Control+p");
	await page
		.getByPlaceholder("Search papers, file paths, and note contents…")
		.fill(`${name}.md`);
	await page
		.getByRole("option")
		.filter({ hasText: `${name}.md` })
		.first()
		.click();
	const exportButton = page.getByRole("button", {
		name: "Share and export note",
		exact: true,
	});
	await exportButton.click();
	const dialog = page.getByRole("dialog", { name: "Share and export note" });
	await dialog.getByRole("button", { name: "Share link", exact: true }).click();
	await expect(
		dialog.getByRole("combobox", { name: "Format", exact: true }),
	).toHaveCount(0);
	await expect(
		dialog.getByRole("checkbox", { name: "Selected note", exact: true }),
	).not.toBeChecked();
	await expect(
		dialog.getByRole("checkbox", { name: "Excluded note", exact: true }),
	).not.toBeChecked();
	await expect(
		dialog.getByRole("checkbox", { name: "Indirect secret", exact: true }),
	).toHaveCount(0);
	await dialog
		.getByRole("checkbox", { name: "Selected note", exact: true })
		.check();
	await dialog.getByRole("checkbox", { name: "Require access key" }).check();
	await dialog
		.getByLabel("Access key", { exact: true })
		.fill("test-access-key");
	await dialog
		.getByRole("button", { name: "Create link", exact: true })
		.click();
	const links = dialog.getByRole("textbox", {
		name: "Share link",
		exact: true,
	});
	await expect(links).toHaveCount(1);
	const protectedUrl = await links.inputValue();
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		protectedUrl,
	);
	await page.screenshot({ path: test.info().outputPath("share-dialog.png") });
	const guest = await browser.newContext();
	const recipient = await guest.newPage();
	const privateRequests: string[] = [];
	recipient.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (path.startsWith("/api/") && !path.startsWith("/api/public-shares/"))
			privateRequests.push(path);
	});
	await recipient.goto(protectedUrl);
	await expect(
		recipient.getByLabel("Access key", { exact: true }),
	).toBeVisible();
	await expect(recipient.locator("article")).toHaveCount(0);
	await recipient.getByLabel("Access key", { exact: true }).fill("wrong-key");
	await recipient
		.getByRole("button", { name: "Open shared file", exact: true })
		.click();
	await expect(
		recipient.getByText("Incorrect access key", { exact: true }),
	).toBeVisible();
	await recipient
		.getByLabel("Access key", { exact: true })
		.fill("test-access-key");
	await recipient
		.getByRole("button", { name: "Open shared file", exact: true })
		.click();
	const article = recipient.locator("article");
	await expect(
		article.getByRole("heading", { name, exact: true }),
	).toBeVisible();
	await expect(article.getByRole("table")).toContainText("42");
	await expect(article.locator(".katex")).toHaveCount(1);
	await expect(article.locator("pre")).toContainText('print("safe code")');
	await expect(
		article.getByRole("link", { name: "Read excluded note", exact: true }),
	).toHaveCount(0);
	await expect(
		recipient.getByRole("link", { name: "Download", exact: true }),
	).toHaveCount(0);
	expect(await recipient.evaluate(() => "evil" in window)).toBe(false);
	const response = await recipient.request.post(
		`/api/public-shares/${protectedUrl.split("/").at(-1)}`,
		{ headers: { origin }, data: { key: "test-access-key" } },
	);
	const snapshot = await response.text();
	expect(snapshot).not.toMatch(
		/never-share|Excluded note private body|Indirect private body/,
	);
	expect(JSON.parse(snapshot).notes).toHaveLength(2);
	await article
		.getByRole("link", { name: "Read selected note", exact: true })
		.click();
	await expect(
		article.getByRole("heading", { name: "Selected note", exact: true }),
	).toBeVisible();
	await expect(article).toContainText("Selected note body");
	await expect(
		article.getByRole("link", { name: "Indirect note", exact: true }),
	).toHaveCount(0);
	await recipient.goBack();
	await expect(
		article.getByRole("heading", { name, exact: true }),
	).toBeVisible();
	await recipient.screenshot({
		path: test.info().outputPath("public-share.png"),
	});
	await recipient.setViewportSize({ width: 390, height: 844 });
	expect(
		await recipient.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	await recipient.screenshot({
		path: test.info().outputPath("public-share-mobile.png"),
	});
	expect(privateRequests).toEqual([]);
	expect(
		await recipient.evaluate(async () => (await indexedDB.databases()).length),
	).toBe(0);
	await dialog
		.getByRole("button", { name: "Close sharing", exact: true })
		.click();
	await expect(links).toHaveCount(0);
	await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(links).toHaveCount(0);
	await recipient.reload();
	await expect(
		recipient.getByText(
			"This share has expired, was closed, or does not exist.",
			{ exact: true },
		),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await exportButton.click();
	await dialog.getByRole("button", { name: "Share link", exact: true }).click();
	await expect(links).toHaveCount(0);
	await expect(
		dialog.getByRole("checkbox", { name: "Selected note", exact: true }),
	).not.toBeChecked();
	await dialog
		.getByRole("combobox", { name: "Expires in", exact: true })
		.selectOption("never");
	await dialog
		.getByRole("button", { name: "Create link", exact: true })
		.click();
	await expect(links).toHaveCount(1);
	const publicUrl = await links.inputValue();
	await recipient.goto(publicUrl);
	await expect(
		article.getByRole("heading", { name, exact: true }),
	).toBeVisible();
	await expect(
		article.getByRole("link", { name: "Read selected note", exact: true }),
	).toHaveCount(0);
	await dialog
		.getByRole("combobox", { name: "Expires in", exact: true })
		.selectOption("custom");
	await dialog
		.locator('input[type="datetime-local"]')
		.fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
	await dialog
		.getByRole("button", { name: "Create link", exact: true })
		.click();
	await expect(links).toHaveCount(2);
	await context.setOffline(true);
	await dialog
		.getByRole("button", { name: "Create link", exact: true })
		.click();
	await expect(
		page.getByText("Sharing requires an internet connection.", { exact: true }),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Download", exact: true }).click();
	await dialog.getByRole("combobox", { name: "Format", exact: true }).click();
	await page.getByRole("option", { name: "Markdown", exact: true }).click();
	const download = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Export", exact: true }).click();
	expect((await download).suggestedFilename()).toBe(`${name}.md`);
	await context.setOffline(false);
	await toolbar.getByRole("button", { name: "Export", exact: true }).click();
	await page
		.getByRole("menuitem", { name: "Manage shares", exact: true })
		.click();
	const manager = page.getByRole("dialog", {
		name: "Manage shares",
		exact: true,
	});
	const row = manager
		.locator("li")
		.filter({ has: page.locator(`input[value="${publicUrl}"]`) });
	await row.getByRole("button", { name: "Close sharing", exact: true }).click();
	await expect(row).toHaveCount(0);
	await manager.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(row).toHaveCount(0);
	await recipient.goto(publicUrl);
	await expect(
		recipient.getByText(
			"This share has expired, was closed, or does not exist.",
			{ exact: true },
		),
	).toBeVisible();
	await guest.close();
});
