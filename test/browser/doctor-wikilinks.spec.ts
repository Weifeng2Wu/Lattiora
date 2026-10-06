import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("doctor repairs edited and chosen targets, persists offline and rejects unresolved replacements", async ({
	page,
}) => {
	test.setTimeout(180000);
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Creates local fixtures");
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
	await finishInitialSetup(page);
	const prefix = `wiki-repair-${Date.now()}`;
	const source = `notes/${prefix}/source.md`;
	const target = `notes/${prefix}/target.md`;
	const content = `中文 [[Missing-${prefix}|说明]]\n[[${target}#Missing|章节]]\n[[Shared-${prefix}|歧义]]\n`;
	for (const [path, text] of [
		[source, content],
		[target, "# Existing\n"],
		[`notes/${prefix}/a.md`, `---\naliases: [Shared-${prefix}]\n---\n# A\n`],
		[`notes/${prefix}/b.md`, `---\naliases: [Shared-${prefix}]\n---\n# B\n`],
	]) {
		expect(
			(
				await page.request.put("/api/file", {
					headers: { origin: new URL(page.url()).origin },
					data: {
						path,
						version: 0,
						mutation_id: crypto.randomUUID(),
						deleted: false,
						mime: "text/markdown",
						blob_key: null,
						content: text,
					},
				})
			).ok(),
		).toBe(true);
	}
	const sync = page.getByRole("button", { name: "Sync now", exact: true });
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await sync.click();
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await page
		.getByRole("toolbar", { name: "Workspace storage" })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Doctor", exact: true }).click();
	await page.getByRole("button", { name: "Probe", exact: true }).click();
	const rows = page.locator("div.border-b").filter({
		has: page.getByLabel(`Select repair in ${source}`, { exact: true }),
	});
	await expect(rows).toHaveCount(3);
	await rows
		.nth(0)
		.getByLabel("Replacement", { exact: true })
		.fill("Still missing");
	await expect(rows.nth(0).getByRole("checkbox")).toBeChecked();
	const section = rows.nth(0).locator("xpath=../..");
	await section.getByRole("button", { name: "Fix", exact: true }).click();
	const confirm = page.getByRole("dialog", {
		name: "Apply link repairs?",
		exact: true,
	});
	await confirm
		.getByRole("button", { name: "Apply changes", exact: true })
		.click();
	await expect(
		page.getByText("Edit the replacement to a valid file or anchor first.", {
			exact: false,
		}),
	).toBeVisible();
	await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
	await rows.nth(0).getByLabel("Replacement", { exact: true }).fill(target);
	await rows.nth(1).getByLabel("Replacement", { exact: true }).fill("Existing");
	await rows
		.nth(2)
		.getByLabel("Choose target file")
		.selectOption(`notes/${prefix}/a.md`);
	await page.context().setOffline(true);
	await section.getByRole("button", { name: "Fix", exact: true }).click();
	await confirm
		.getByRole("button", { name: "Apply changes", exact: true })
		.click();
	await expect(confirm).toHaveCount(0);
	await expect(
		page.getByText("Updated links in 1 file(s).", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.context().setOffline(false);
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await sync.click();
	await expect
		.poll(
			async () =>
				(
					await page.request.get(`/api/file?path=${encodeURIComponent(source)}`)
				).text(),
			{ timeout: 60000 },
		)
		.toBe(
			`中文 [[${target}|说明]]\n[[${target}#Existing|章节]]\n[[/notes/${prefix}/a.md|歧义]]\n`,
		);
});
