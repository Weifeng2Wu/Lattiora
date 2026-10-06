import { expect, type Page, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

async function login(page: Page, home = false) {
	await page.goto("/");
	await page
		.getByLabel("Access password")
		.fill(
			process.env.AGENTERO_TEST_PASSWORD ??
				"local-development-password-32-chars",
		);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toBeVisible({ timeout: 90000 });
	await finishInitialSetup(page, { stayOnHome: home });
}
async function files(page: Page, prefix: string) {
	return page.evaluate(async (prefix) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const r = indexedDB.open("agentero-cloud-v1");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		const list = await new Promise<
			Array<{ path: string; mime: string; deleted: number; data: Blob }>
		>((resolve) => {
			const r = db.transaction("files").objectStore("files").getAll();
			r.onsuccess = () => resolve(r.result);
		});
		db.close();
		return Promise.all(
			list
				.filter(
					(f) =>
						!f.deleted &&
						f.path.startsWith(prefix) &&
						f.mime !== "inode/directory",
				)
				.map(async (f) => ({
					path: f.path,
					mime: f.mime,
					text: await f.data.text(),
				})),
		);
	}, prefix);
}
test.beforeEach(() =>
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Uses isolated fixtures"),
);
test("new notes default to Markdown and share edit, split and preview views without losing source edits", async ({
	page,
	context,
}) => {
	test.setTimeout(180000);
	await login(page);
	const name = `markdown-${Date.now()}`;
	await page
		.getByRole("treeitem", { name: "notes", exact: true })
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: "New file", exact: true }).click();
	await page.getByRole("textbox", { name: "New file", exact: true }).fill(name);
	await page
		.getByRole("textbox", { name: "New file", exact: true })
		.press("Enter");
	const editor = page
		.locator('[data-slate-editor="true"][contenteditable="true"]')
		.filter({ visible: true });
	await expect(editor).toBeVisible();
	await expect
		.poll(async () => (await files(page, `notes/${name}`))[0]?.path)
		.toBe(`notes/${name}.md`);
	await editor.pressSequentially("# Live heading");
	await expect(
		editor.getByRole("heading", { name: "Live heading" }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Edit and preview", exact: true })
		.click();
	const source = page.getByRole("textbox", {
		name: "Markdown source",
		exact: true,
	});
	const markdown =
		"---\ntitle: source preserved\n---\n\n# Shared rendering\n\n**bold text** and $x^2$.\n\n- First\n- Second\n";
	await source.fill(markdown);
	await expect(
		page.getByRole("heading", { name: "Shared rendering", exact: true }),
	).toBeVisible();
	await expect(
		page.locator("strong").filter({ hasText: "bold text" }),
	).toBeVisible();
	await expect
		.poll(async () => (await files(page, `notes/${name}.md`))[0]?.text)
		.toBe(markdown);
	await page.getByRole("button", { name: "Preview only", exact: true }).click();
	await expect(source).toHaveCount(0);
	await expect(editor).toHaveCount(0);
	await expect(
		page.getByRole("heading", { name: "Shared rendering", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toContainText("Offline ready", { timeout: 90000 });
	await context.setOffline(true);
	await page.reload();
	await expect(
		page.getByRole("heading", { name: "Shared rendering", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await expect(editor).toBeVisible();
	await editor.click();
	await editor.press("Control+End");
	await editor.press("Enter");
	await editor.pressSequentially("Rich edit retained.");
	await expect
		.poll(async () => (await files(page, `notes/${name}.md`))[0]?.text)
		.toContain("Rich edit retained.");
	await page
		.getByRole("button", { name: "Edit and preview", exact: true })
		.click();
	await expect(source).toContainText("Rich edit retained.");
	await page.screenshot({ path: test.info().outputPath("markdown-split.png") });
});

test("quick capture retains a draft, saves offline as a Markdown file, and opens its rendered note", async ({
	page,
	context,
}) => {
	test.setTimeout(180000);
	await login(page, true);
	await page
		.getByRole("button", { name: "Customize home", exact: true })
		.click();
	const dialog = page.getByRole("dialog", { name: "Customize home" });
	await dialog
		.getByRole("checkbox", { name: "Quick capture", exact: true })
		.check();
	await dialog
		.getByRole("button", { name: "Save layout", exact: true })
		.click();
	const capsule = page.getByRole("region", {
		name: "Quick capture",
		exact: true,
	});
	const draft = `A **fleeting thought** ${Date.now()}`;
	const input = capsule.getByRole("textbox", {
		name: "Catch a thought…",
		exact: true,
	});
	await input.fill(draft);
	await expect(
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toContainText("Offline ready", { timeout: 90000 });
	await context.setOffline(true);
	await page.reload();
	await expect(input).toHaveValue(draft);
	await input.press("Control+Enter");
	await expect(input).toHaveValue("");
	await expect(
		capsule.getByRole("button").filter({ hasText: draft }),
	).toBeVisible();
	await expect
		.poll(async () =>
			(await files(page, "notes/quick-captures/")).some(
				(f) => f.path.endsWith(".md") && f.text === draft + "\n",
			),
		)
		.toBe(true);
	await capsule.getByRole("button").filter({ hasText: draft }).click();
	await expect(
		page
			.locator('[data-slate-editor="true"] strong')
			.filter({ hasText: "fleeting thought" }),
	).toBeVisible();
	await context.setOffline(false);
});
