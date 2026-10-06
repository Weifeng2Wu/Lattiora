import { expect, type Page, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

async function login(page: Page) {
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
	if (
		await page
			.getByRole("button", { name: "Hide right sidebar", exact: true })
			.isVisible()
	)
		await page
			.getByRole("button", { name: "Hide right sidebar", exact: true })
			.click();
}
async function file(page: Page, path: string) {
	return page.evaluate(async (path) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open("agentero-cloud-v1");
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const record = await new Promise<
			{ data: Blob; dirty: boolean } | undefined
		>((resolve, reject) => {
			const req = db.transaction("files").objectStore("files").get(path);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		db.close();
		return record
			? { text: await record.data.text(), dirty: record.dirty }
			: null;
	}, path);
}
async function open(page: Page, name: string) {
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible({ timeout: 60000 });
	await expect(page.getByRole("tree")).toBeVisible();
	await page.keyboard.press("Control+p");
	await page
		.getByPlaceholder("Search papers, file paths, and note contents…")
		.fill(name);
	await page.getByRole("option").filter({ hasText: name }).first().click();
}
async function create(page: Page, kind: "mindmap" | "kanban", name: string) {
	const notes = page.getByRole("treeitem", { name: "notes", exact: true });
	await notes.click({ button: "right" });
	const label = kind === "mindmap" ? "New mind map" : "New Kanban board";
	await page.getByRole("menuitem", { name: label, exact: true }).click();
	await page.getByRole("textbox", { name: label, exact: true }).fill(name);
	await page.getByRole("textbox", { name: label, exact: true }).press("Enter");
}

test("visual files create, edit, undo, drag, export, reload offline and sync to another device", async ({
	page,
	browser,
	context,
}) => {
	test.setTimeout(240000);
	const prefix = `visual-${Date.now()}`;
	const mindName = `${prefix}.mindmap.json`;
	const boardName = `${prefix}.kanban.json`;
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await login(page);
	await create(page, "mindmap", prefix);
	const topics = page.getByRole("textbox", { name: "Topic text", exact: true });
	await expect(topics).toHaveCount(1);
	const smallCanvas = await page.locator("[data-mind-map]").boundingBox();
	if (!smallCanvas) throw new Error("Missing canvas");
	const originalCamera = await page
		.locator("[data-mind-map-content]")
		.getAttribute("style");
	await page.mouse.move(smallCanvas.x + 350, smallCanvas.y + 200);
	await page.mouse.down();
	await page.mouse.move(smallCanvas.x + 420, smallCanvas.y + 240, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator("[data-mind-map-content]")).not.toHaveAttribute(
		"style",
		originalCamera ?? "",
	);
	await topics.first().fill("研究计划");
	await page
		.getByRole("button", { name: "Add child node", exact: true })
		.click();
	await expect(topics).toHaveCount(2);
	await expect(topics.nth(1)).toBeFocused();
	await topics.nth(1).fill("Method");
	await page
		.getByRole("button", { name: "Add sibling node", exact: true })
		.click();
	await topics.nth(2).fill("Evaluation");
	await topics.nth(1).focus();
	await page
		.getByRole("button", { name: "Add child node", exact: true })
		.click();
	await topics.nth(3).fill("Baseline");
	await page
		.getByRole("button", { name: "Collapse branch", exact: true })
		.nth(1)
		.click();
	await expect(topics).toHaveCount(3);
	await page
		.getByRole("button", { name: "Expand branch", exact: true })
		.click();
	await expect(topics).toHaveCount(4);
	await page
		.getByRole("button", { name: "Delete branch", exact: true })
		.click();
	await expect(topics).toHaveCount(2);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(topics).toHaveCount(4);
	await topics.nth(3).focus();
	await topics.nth(3).press("Control+Enter");
	await expect(topics).toHaveCount(5);
	await expect(topics.nth(4)).toBeFocused();
	await topics.nth(4).fill("Shortcut child");
	await topics.nth(4).dispatchEvent("keydown", {
		key: "Enter",
		ctrlKey: true,
		isComposing: true,
	});
	await expect(topics).toHaveCount(5);
	await topics.nth(4).press("Alt+Enter");
	await expect(topics).toHaveCount(6);
	await expect(topics.nth(5)).toBeFocused();
	await page.getByRole("button", { name: "Fit to view", exact: true }).click();
	await page
		.getByRole("button", { name: "Collapse branch", exact: true })
		.first()
		.click();
	await expect(topics).toHaveCount(1);
	await page
		.getByRole("button", { name: "Expand all branches", exact: true })
		.click();
	await expect(topics).toHaveCount(6);
	await page.getByRole("button", { name: "Fit to view", exact: true }).click();
	await page
		.getByRole("button", { name: "Center selected topic", exact: true })
		.click();
	await page.getByRole("button", { name: "Reset zoom", exact: true }).click();
	for (let i = 0; i < 5; i++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	const canvas = page.locator("[data-mind-map]");
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("Missing mind map viewport");
	const initialTransform = await page
		.locator("[data-mind-map-content]")
		.getAttribute("style");
	await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + 8);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width - 130, bounds.y + 8, {
		steps: 5,
	});
	await page.mouse.up();
	await expect
		.poll(() => page.locator("[data-mind-map-content]").getAttribute("style"))
		.not.toBe(initialTransform);
	await page.getByRole("button", { name: "Fit to view", exact: true }).click();
	await expect
		.poll(async () => (await file(page, `notes/${mindName}`))?.text)
		.toContain("Baseline");
	await topics.nth(1).focus();
	await page.getByLabel("Branch color", { exact: true }).fill("#ff0000");
	const handle = page
		.getByRole("button", {
			name: "Move topic (drag or arrow keys)",
			exact: true,
		})
		.nth(1);
	const before = await handle.boundingBox();
	if (!before) throw new Error("Missing drag handle");
	await page.mouse.move(
		before.x + before.width / 2,
		before.y + before.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		before.x + before.width / 2 + 60,
		before.y + before.height / 2 + 45,
		{ steps: 5 },
	);
	await page.mouse.up();
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await file(page, `notes/${mindName}`))?.text ?? "{}",
				).nodes?.find((n: { text: string }) => n.text === "Method")?.offset?.x,
		)
		.toBeGreaterThan(0);
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await file(page, `notes/${mindName}`))?.text ?? "{}",
				).nodes?.find((n: { text: string }) => n.text === "Method")?.color,
		)
		.toBe("#ff0000");
	await page
		.getByRole("button", { name: "Restore automatic layout", exact: true })
		.click();
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await file(page, `notes/${mindName}`))?.text ?? "{}",
				).nodes?.find((n: { text: string }) => n.text === "Method")?.offset,
		)
		.toBeUndefined();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await file(page, `notes/${mindName}`))?.text ?? "{}",
				).nodes?.find((n: { text: string }) => n.text === "Method")?.offset?.x,
		)
		.toBeGreaterThan(0);
	await page.getByRole("button", { name: "Fit to view", exact: true }).click();
	const download = page.waitForEvent("download");
	await page
		.getByRole("button", { name: "Download JSON", exact: true })
		.click();
	expect((await download).suggestedFilename()).toBe(mindName);
	await page.screenshot({ path: test.info().outputPath("mind-map.png") });

	await create(page, "kanban", prefix);
	const columns = page.locator("[data-kanban] section");
	await expect(columns).toHaveCount(3);
	await columns
		.nth(0)
		.getByRole("button", { name: "Add card", exact: true })
		.click();
	await page
		.getByRole("textbox", { name: "Card title", exact: true })
		.fill("Read paper");
	await page
		.getByRole("textbox", { name: "Description", exact: true })
		.fill("Check the baseline");
	await columns
		.nth(0)
		.getByRole("button", { name: "Add card", exact: true })
		.click();
	await page
		.getByRole("textbox", { name: "Card title", exact: true })
		.nth(1)
		.fill("Run experiment");
	await columns
		.nth(0)
		.getByRole("button", { name: "Move card up", exact: true })
		.nth(1)
		.click();
	await expect(
		page.getByRole("textbox", { name: "Card title", exact: true }).first(),
	).toHaveValue("Run experiment");
	await columns
		.nth(0)
		.getByRole("button", { name: "Drag card", exact: true })
		.first()
		.dragTo(columns.nth(1));
	await expect(
		columns.nth(1).getByRole("textbox", { name: "Card title", exact: true }),
	).toHaveValue("Run experiment");
	await columns
		.nth(0)
		.getByRole("combobox", { name: "Move to column", exact: true })
		.selectOption({ label: "Done" });
	await expect(
		columns.nth(2).getByRole("textbox", { name: "Card title", exact: true }),
	).toHaveValue("Read paper");
	await columns
		.nth(2)
		.getByRole("button", { name: "Delete column", exact: true })
		.click();
	await expect(columns).toHaveCount(2);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(columns).toHaveCount(3);
	await expect(
		columns.nth(2).getByRole("textbox", { name: "Description", exact: true }),
	).toHaveValue("Check the baseline");
	await expect
		.poll(async () => (await file(page, `notes/${boardName}`))?.dirty, {
			timeout: 90000,
		})
		.toBe(false);
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await page.screenshot({ path: test.info().outputPath("kanban.png") });
	await context.setOffline(true);
	await columns
		.nth(1)
		.getByRole("textbox", { name: "Card title", exact: true })
		.fill("Offline experiment");
	await expect
		.poll(async () => (await file(page, `notes/${boardName}`))?.text)
		.toContain("Offline experiment");
	await page.reload({ waitUntil: "domcontentloaded" });
	await open(page, boardName);
	await expect(
		page.getByRole("textbox", { name: "Card title", exact: true }).first(),
	).toHaveValue("Offline experiment");
	await open(page, mindName);
	await expect(topics.first()).toHaveValue("研究计划");
	await topics.nth(1).focus();
	await expect(page.getByLabel("Branch color", { exact: true })).toHaveValue(
		"#ff0000",
	);
	await expect(
		page.getByRole("button", { name: "Restore automatic layout", exact: true }),
	).toBeEnabled();
	await topics.first().fill("Offline research plan");
	await expect
		.poll(async () => (await file(page, `notes/${mindName}`))?.text)
		.toContain("Offline research plan");
	await context.setOffline(false);
	await expect
		.poll(async () => (await file(page, `notes/${boardName}`))?.dirty, {
			timeout: 60000,
		})
		.toBe(false);
	await expect
		.poll(async () => (await file(page, `notes/${mindName}`))?.dirty, {
			timeout: 60000,
		})
		.toBe(false);
	const device = await browser.newContext({
		baseURL: new URL(page.url()).origin,
		viewport: { width: 1440, height: 960 },
	});
	try {
		const second = await device.newPage();
		await login(second);
		await expect
			.poll(async () => (await file(second, `notes/${mindName}`))?.text)
			.toContain("Offline research plan");
		await open(second, mindName);
		await expect(
			second.getByRole("textbox", { name: "Topic text", exact: true }).first(),
		).toHaveValue("Offline research plan");
		await open(second, boardName);
		await expect(
			second.getByRole("textbox", { name: "Card title", exact: true }).first(),
		).toHaveValue("Offline experiment");
	} finally {
		await device.close();
	}
	expect(errors).toEqual([]);
});
