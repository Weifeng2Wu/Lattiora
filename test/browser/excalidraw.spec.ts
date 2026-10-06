import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test.use({ actionTimeout: 20000 });

async function login(page: Page) {
	// Exercise standard input/download fallbacks; headless Chromium cannot operate native OS pickers.
	await page.addInitScript(() => {
		for (const key of [
			"showOpenFilePicker",
			"showSaveFilePicker",
			"showDirectoryPicker",
		])
			Reflect.deleteProperty(window, key);
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
	const hide = page.getByRole("button", {
		name: "Hide right sidebar",
		exact: true,
	});
	if (await hide.isVisible()) await hide.click();
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
	await expect(page.getByRole("tree")).toBeVisible();
	await page.keyboard.press("Control+p");
	await page
		.getByPlaceholder("Search papers, file paths, and note contents…")
		.fill(name);
	await page.getByRole("option").filter({ hasText: name }).first().click();
	await expect(page.locator(".excalidraw canvas").first()).toBeVisible();
}

test("Excalidraw creates, embeds images, exports, persists a library, reloads offline and syncs", async ({
	page,
	context,
	browser,
}) => {
	test.setTimeout(300000);
	const name = `drawing-${Date.now()}`;
	const path = `notes/${name}.excalidraw`;
	const errors: string[] = [];
	const fontFailures: string[] = [];
	const loadedFonts = new Set<string>();
	page.on("requestfailed", (request) => {
		if (!request.url().includes(".woff2")) return;
		// Chromium checks every FontFace src against CSP, including the SDK's
		// CDN fallback, even when the first (local) source loads successfully.
		if (
			request.url().startsWith("https://esm.sh/@excalidraw/") &&
			request.failure()?.errorText === "csp"
		)
			return;
		fontFailures.push(request.url());
	});
	page.on("response", (response) => {
		if (response.url().includes("/excalidraw/fonts/") && response.ok())
			loadedFonts.add(response.url());
	});
	page.on("pageerror", (error) => errors.push(error.message));
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await login(page);
	await page
		.getByRole("treeitem", { name: "notes", exact: true })
		.click({ button: "right" });
	await page
		.getByRole("menuitem", { name: "New Excalidraw drawing", exact: true })
		.click();
	await page
		.getByRole("textbox", { name: "New Excalidraw drawing", exact: true })
		.fill(name);
	await page
		.getByRole("textbox", { name: "New Excalidraw drawing", exact: true })
		.press("Enter");
	const canvas = page.locator(".excalidraw .excalidraw__canvas.interactive");
	await expect(canvas).toBeVisible();
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Missing canvas");
	await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
	await page.mouse.move(box.x + 250, box.y + 220);
	await page.mouse.down();
	await page.mouse.move(box.x + 470, box.y + 360, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(
			async () =>
				JSON.parse((await file(page, path))?.text ?? "{}").elements?.length,
		)
		.toBe(1);
	// The image tool imports actual bytes, which must remain in the .excalidraw file.
	const png = await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 80;
		canvas.height = 60;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("No canvas");
		ctx.fillStyle = "#ff0000";
		ctx.fillRect(0, 0, 80, 60);
		return canvas.toDataURL("image/png").split(",")[1];
	});
	const imageChooser = page.waitForEvent("filechooser");
	await page.locator('label:has([data-testid="toolbar-image"])').click();
	await (await imageChooser).setFiles({
		name: "pixel.png",
		mimeType: "image/png",
		buffer: Buffer.from(png, "base64"),
	});
	await expect(canvas).toHaveCSS("cursor", /url\(/);
	await page.mouse.click(box.x + 600, box.y + 350);
	await expect
		.poll(
			async () =>
				Object.keys(
					JSON.parse((await file(page, path))?.text ?? "{}").files ?? {},
				).length,
		)
		.toBe(1);
	await expect
		.poll(
			async () =>
				JSON.parse((await file(page, path))?.text ?? "{}").elements?.find(
					(e: { type: string }) => e.type === "image",
				)?.width,
		)
		.toBeGreaterThan(0);
	await page.locator('label:has([data-testid="toolbar-text"])').click();
	await page.mouse.click(box.x + 780, box.y + 250);
	await page.keyboard.insertText("研究流程 / Method");
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await file(page, path))?.text)
		.toContain("研究流程 / Method");
	// Select the rectangle alone and add it to the shared library.
	await page.keyboard.press("Escape");
	await page.locator('label:has([data-testid="toolbar-selection"])').click();
	await page.mouse.click(box.x + 250, box.y + 250);
	await page.mouse.click(box.x + 250, box.y + 250, { button: "right" });
	await page.getByText("Add to library", { exact: true }).click();
	const libraryPath = ".agentero/excalidraw/library.excalidrawlib";
	await expect
		.poll(
			async () =>
				JSON.parse((await file(page, libraryPath))?.text ?? "{}").libraryItems
					?.length,
		)
		.toBeGreaterThan(0);
	// Clipboard shortcuts belong to canvas elements, not the selected vault file.
	await page.mouse.click(box.x + 250, box.y + 250);
	await page.keyboard.press("Control+x");
	await expect
		.poll(
			async () =>
				JSON.parse((await file(page, path))?.text ?? "{}").elements?.filter(
					(e: { type: string }) => e.type === "rectangle",
				).length,
		)
		.toBe(0);
	await page.keyboard.press("Control+v");
	await expect
		.poll(
			async () =>
				JSON.parse((await file(page, path))?.text ?? "{}").elements?.filter(
					(e: { type: string }) => e.type === "rectangle",
				).length,
		)
		.toBe(1);
	await page.keyboard.press("Escape");
	await page.getByTestId("main-menu-trigger").click();
	await page.getByTestId("image-export-button").click();
	const selectedOnly = page.getByRole("checkbox", {
		name: "Only selected",
		exact: true,
	});
	if (await selectedOnly.isChecked())
		await page.getByText("Only selected", { exact: true }).click();
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: /^Export to SVG/ }).click();
	const svgDownload = await download;
	expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/);
	const svgPath = await svgDownload.path();
	if (!svgPath) throw new Error("Missing SVG download");
	const svg = await readFile(svgPath, "utf8");
	expect(svg).toContain("研究流程");
	expect(svg).toMatch(/@font-face[\s\S]*data:/);
	expect(svg).not.toContain("https://esm.sh/");
	expect([...loadedFonts].some((url) => url.includes("/Excalifont/"))).toBe(
		true,
	);
	expect([...loadedFonts].some((url) => url.includes("/Xiaolai/"))).toBe(true);
	await page
		.locator(".excalidraw-modal-container")
		.getByRole("dialog")
		.getByRole("textbox")
		.press("Escape");
	await expect(
		page.locator(".excalidraw-modal-container").getByRole("dialog"),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect.poll(async () => (await file(page, path))?.dirty).toBe(false);
	await expect
		.poll(async () => (await file(page, libraryPath))?.dirty)
		.toBe(false);
	await expect
		.poll(
			() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
			{ timeout: 90000 },
		)
		.toBe(true);
	await context.setOffline(true);
	await page.reload();
	await open(page, `${name}.excalidraw`);
	await expect
		.poll(() =>
			page.evaluate(() =>
				Array.from(document.fonts).some(
					(font) => font.family === "Xiaolai" && font.status === "loaded",
				),
			),
		)
		.toBe(true);
	expect(
		Object.keys(JSON.parse((await file(page, path))?.text ?? "{}").files),
	).toHaveLength(1);
	// Draw offline and save through the workspace shortcut.
	await page.locator('label:has([data-testid="toolbar-ellipse"])').click();
	const offlineBox = await canvas.boundingBox();
	if (!offlineBox) throw new Error("Missing offline canvas");
	await page.mouse.move(offlineBox.x + 260, offlineBox.y + 450);
	await page.mouse.down();
	await page.mouse.move(offlineBox.x + 410, offlineBox.y + 550, { steps: 5 });
	await page.mouse.up();
	await page.keyboard.press("Control+s");
	await expect
		.poll(
			async () =>
				JSON.parse((await file(page, path))?.text ?? "{}").elements?.filter(
					(e: { type: string }) => e.type === "ellipse",
				).length,
		)
		.toBe(1);
	await page.screenshot({ path: "test-results/excalidraw-offline.png" });
	await context.setOffline(false);
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect.poll(async () => (await file(page, path))?.dirty).toBe(false);
	const second = await browser.newContext();
	try {
		const other = await second.newPage();
		await login(other);
		await open(other, `${name}.excalidraw`);
		expect(
			JSON.parse((await file(other, path))?.text ?? "{}").elements.some(
				(e: { type: string }) => e.type === "ellipse",
			),
		).toBe(true);
		expect(
			Object.keys(JSON.parse((await file(other, path))?.text ?? "{}").files),
		).toHaveLength(1);
		expect(
			JSON.parse((await file(other, libraryPath))?.text ?? "{}").libraryItems
				.length,
		).toBeGreaterThan(0);
	} finally {
		await second.close();
	}
	expect(errors).toEqual([]);
	expect(fontFailures).toEqual([]);
});
