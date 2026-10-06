import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("mention folders reveal nested files on hover without replacing their parent", async ({
	page,
}) => {
	test.setTimeout(180000);
	const folder = `hover-${Date.now()}`;
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
	const sidebar = page.locator("[data-vault-sidebar]");
	const create = async (
		parent: string,
		kind: "folder" | "file",
		name: string,
	) => {
		await sidebar
			.getByRole("treeitem", { name: parent, exact: true })
			.click({ button: "right" });
		await page
			.getByRole("menuitem", { name: `New ${kind}`, exact: true })
			.click();
		const input = sidebar.getByRole("textbox", {
			name: `New ${kind}`,
			exact: true,
		});
		await input.fill(name);
		await input.press("Enter");
	};
	await create("notes", "folder", folder);
	await create(folder, "folder", "nested");
	await create("nested", "file", "source.md");
	await sidebar.getByRole("treeitem", { name: "Library", exact: true }).click();
	const showAgent = page.getByRole("button", {
		name: "Show right sidebar",
		exact: true,
	});
	if (await showAgent.isVisible()) await showAgent.click();
	const composer = page.locator("[data-agent-composer-input]:visible");
	await composer.fill(`@${folder}`);
	const menu = page.locator("#agent-mention-menu");
	const parent = menu
		.getByRole("option")
		.filter({ has: page.locator(`[title="notes/${folder}"]`) })
		.first();
	await parent.hover();
	const children = page.getByRole("listbox", { name: folder, exact: true });
	await expect(children).toBeVisible();
	await expect(parent).toBeVisible();
	await children.getByRole("option", { name: "nested", exact: true }).hover();
	const nested = page.getByRole("listbox", { name: "nested", exact: true });
	await expect(nested).toBeVisible();
	await page.screenshot({ path: "test-results/agent-mention-hover.png" });
	await nested.getByRole("option", { name: "source.md", exact: true }).click();
	await expect(menu).toBeHidden();
	await expect(composer).toContainText("source.md");
	// The parent remains a selectable reference after its hover preview opens.
	await composer.fill(`@${folder}`);
	await parent.hover();
	await expect(children).toBeVisible();
	await parent.click();
	await expect(menu).toBeHidden();
	await expect(composer).toContainText(folder);
	// Existing keyboard drill-down and selection still work.
	await composer.fill(`@${folder}`);
	await composer.press("ArrowRight");
	await expect(
		menu.getByRole("button", { name: "Back to parent folder", exact: true }),
	).toBeVisible();
	await composer.press("Enter");
	await expect(menu).toBeHidden();
	await expect(composer).toContainText("nested");
});
