import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("home uses real boards, saves offline tasks and retains workspace navigation", async ({
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
	await finishInitialSetup(page, { stayOnHome: true });
	const home = page.getByRole("region", { name: "Home", exact: true });
	await expect(home).toBeVisible();
	await expect(home.getByRole("timer", { name: "Current time" })).toHaveText(
		/\d{2}:\d{2}:\d{2}/,
	);
	const prefix = `home-${Date.now()}`;
	const path = `notes/${prefix}.kanban.json`;
	const board = {
		type: "kanban",
		version: 1,
		columns: [
			{
				id: "todo",
				title: "To do",
				cards: [
					{ id: "a", title: "Read related work", description: "Two papers" },
				],
			},
			{
				id: "done",
				title: "Done",
				cards: [{ id: "b", title: "Set up experiment", description: "" }],
			},
		],
	};
	expect(
		(
			await page.request.put("/api/file", {
				headers: { origin: new URL(page.url()).origin },
				data: {
					path,
					version: 0,
					mutation_id: crypto.randomUUID(),
					deleted: false,
					mime: "application/json",
					blob_key: null,
					content: JSON.stringify(board),
				},
			})
		).ok(),
	).toBe(true);
	const sync = page.getByRole("button", { name: "Sync now", exact: true });
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await sync.click();
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await expect(
		home
			.getByRole("combobox", { name: "Board", exact: true })
			.getByRole("option", { name: prefix, exact: true }),
	).toBeAttached();
	await home
		.getByRole("combobox", { name: "Board", exact: true })
		.selectOption(path);
	await expect(
		home.getByRole("progressbar", { name: "Selected board progress" }),
	).toHaveAttribute("value", "50");
	await expect(
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toContainText("Offline ready", {
		timeout: 90000,
	});
	await page.context().setOffline(true);
	await home
		.getByLabel("Add a task…", { exact: true })
		.fill("Write method draft");
	await home.getByRole("button", { name: "Add task", exact: true }).click();
	await expect(
		home.getByRole("checkbox", { name: "Complete Write method draft" }),
	).toBeVisible();
	await home
		.getByRole("checkbox", { name: "Complete Read related work" })
		.click();
	await expect(
		home.getByRole("progressbar", { name: "Selected board progress" }),
	).toHaveAttribute("value", "67");
	await page.reload();
	await expect(
		home.getByRole("checkbox", { name: "Complete Write method draft" }),
	).toBeVisible({ timeout: 90000 });
	await expect(
		page.getByRole("treeitem", { name: "notes", exact: true }),
	).toBeVisible({ timeout: 90000 });
	await expect
		.poll(() =>
			home.locator("h1").evaluate((heading) => {
				const rect = heading.getBoundingClientRect();
				return heading.contains(
					document.elementFromPoint(
						rect.x + rect.width / 2,
						rect.y + rect.height / 2,
					),
				);
			}),
		)
		.toBe(true);
	await home
		.getByRole("checkbox", { name: "Complete Write method draft" })
		.click();
	await expect(
		home.getByRole("progressbar", { name: "Selected board progress" }),
	).toHaveAttribute("value", "100");
	await home.locator("summary").click();
	await home
		.getByRole("checkbox", { name: "Reopen Write method draft" })
		.click();
	await expect(
		home.getByRole("progressbar", { name: "Selected board progress" }),
	).toHaveAttribute("value", "67");
	await page.screenshot({ path: test.info().outputPath("home-desktop.png") });
	await page.context().setOffline(false);
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await sync.click();
	await expect
		.poll(
			async () => {
				const data = await (
					await page.request.get(`/api/file?path=${encodeURIComponent(path)}`)
				).json();
				return data.columns.find(
					(column: { id: string }) => column.id === "done",
				).cards.length;
			},
			{ timeout: 60000 },
		)
		.toBe(2);
	await home.getByRole("button", { name: "Open board", exact: true }).click();
	await expect(home).toHaveCount(0);
	await expect(page.locator("[data-kanban]")).toBeVisible();
	await expect(
		page.getByLabel("Card title", { exact: true }).filter({ visible: true }),
	).toHaveCount(3);
	await page
		.getByRole("toolbar", { name: "Workspace storage" })
		.getByRole("button", { name: "Home", exact: true })
		.click();
	await expect(home).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(home).toBeVisible({ timeout: 90000 });
	await expect(
		home.getByRole("checkbox", { name: "Complete Write method draft" }),
	).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		)
		.toBe(true);
	await page.screenshot({ path: test.info().outputPath("home-mobile.png") });
});
