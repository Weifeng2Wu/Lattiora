import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { finishInitialSetup } from "./setup";

const password =
	process.env.AGENTERO_TEST_PASSWORD ?? "local-development-password-32-chars";
const prefix = `Browser-${Date.now()}`;

async function login(page: Page) {
	await page.goto("/");
	await page.getByLabel("Access password").fill(password);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible({ timeout: 60000 });
	await finishInitialSetup(page);
}
async function toggleAnalysis(page: Page) {
	const button = page.getByRole("button", { name: "Analysis", exact: true });
	const rect = await button.boundingBox();
	expect(rect).not.toBeNull();
	// The original PDF toolbar reveals on pointer proximity and fades while reading.
	// Move into its top zone before Playwright performs its pointer-hit checks.
	await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
	await button.click();
}

async function importFile(
	page: Page,
	menu: string,
	name: string,
	buffer: Buffer,
	mimeType: string,
) {
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const picker = page.waitForEvent("filechooser");
	await page.getByRole("menuitem", { name: menu, exact: true }).click();
	await (await picker).setFiles({ name, buffer, mimeType });
}
async function files(page: Page) {
	return page.evaluate(async () => {
		if (
			!(await indexedDB.databases()).some(
				(entry) => entry.name === "agentero-cloud-v1",
			)
		)
			return [];
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open("agentero-cloud-v1", 1);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const records = await new Promise<
			Array<{
				path: string;
				data: Blob | null;
				dirty: boolean;
				deleted: number;
			}>
		>((resolve, reject) => {
			const req = db.transaction("files").objectStore("files").getAll();
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		db.close();
		return Promise.all(
			records.map(async ({ path, data, dirty, deleted }) => ({
				path,
				dirty,
				deleted,
				text: data && !path.endsWith(".pdf") ? await data.text() : "",
			})),
		);
	});
}
async function synchronize(page: Page, path: string) {
	const button = page.getByRole("button", { name: "Sync now", exact: true });
	if (await button.isEnabled()) await button.click();
	await expect
		.poll(
			async () => (await files(page)).find((file) => file.path === path)?.dirty,
			{ timeout: 60000 },
		)
		.toBe(false);
}
async function openNote(page: Page, name: string) {
	const tab = page.getByRole("tab").filter({ hasText: name }).first();
	if (await tab.count()) await tab.click();
	else {
		const sidebar = page.locator("[data-vault-sidebar]");
		const scroll = sidebar
			.locator(".agentero-scroll")
			.filter({ has: page.getByRole("tree") })
			.last();
		await scroll.evaluate((element) => {
			element.scrollTop = 0;
		});
		const folder = sidebar.getByRole("treeitem", {
			name: "notes",
			exact: true,
		});
		await expect(folder).toBeVisible();
		if ((await folder.getAttribute("aria-expanded")) !== "true")
			await folder.click();
		const row = sidebar.getByTitle(name, { exact: true });
		await expect
			.poll(async () => {
				if (await row.count()) return true;
				await scroll.evaluate((element) =>
					element.scrollBy(0, element.clientHeight * 0.7),
				);
				return false;
			})
			.toBe(true);
		await row.click();
	}
	const editor = page
		.locator('[contenteditable="true"][role="textbox"]')
		.filter({ hasText: "Device sync" });
	await expect(editor).toBeVisible();
	return editor;
}

test("original PDF, notes and AI workflow survives offline reload and preserves two-device conflicts", async ({
	browser,
	page,
}) => {
	test.setTimeout(300000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("crash", () => errors.push("Browser renderer crashed"));
	const anonymous = await page.request.get("/api/changes");
	expect(anonymous.status()).toBe(401);
	await login(page);
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	pdf
		.addPage()
		.drawText(
			"Agentero research. Offline storage preserves research notes across devices.",
			{ x: 35, y: 700, size: 13, font },
		);
	const title = `${prefix} paper`;
	await importFile(
		page,
		"Import PDF to library",
		`${title}.pdf`,
		Buffer.from(await pdf.save()),
		"application/pdf",
	);
	await page.getByRole("row").filter({ hasText: title }).click();
	await expect
		.poll(() =>
			page
				.locator('img[src^="blob:"]')
				.evaluateAll((images) =>
					images.some(
						(image) => (image as HTMLImageElement).naturalWidth > 100,
					),
				),
		)
		.toBe(true);
	await toggleAnalysis(page);
	await page
		.getByRole("button", {
			name: "Detect figures, tables, and formulas",
			exact: true,
		})
		.last()
		.click();
	await expect
		.poll(
			async () =>
				(await files(page)).find(
					(file) => file.path === `papers/${title}/source/parsed.md`,
				)?.text,
			{ timeout: 120_000 },
		)
		.toContain("Offline storage preserves research notes");
	await toggleAnalysis(page);
	await page
		.getByRole("button", { name: "Add visual annotation", exact: true })
		.click();
	const image = page.locator('img[src^="blob:"]').first();
	const rect = await image.boundingBox();
	expect(rect).not.toBeNull();
	await page.mouse.move(rect!.x + 30, rect!.y + 50);
	await page.mouse.down();
	await page.mouse.move(rect!.x + 220, rect!.y + 120, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(async () =>
			(await files(page)).some(
				(file) =>
					file.path.startsWith(`papers/${title}/marks/`) &&
					file.path.endsWith(".json"),
			),
		)
		.toBe(true);
	const annotationEditor = page.getByRole("textbox", {
		name: "Annotation note",
		exact: true,
	});
	await expect(annotationEditor).toBeVisible();
	await annotationEditor.fill(
		"Compact annotation remains accessible beside the notes pane.",
	);
	const assertAnnotationFits = async () => {
		await expect
			.poll(() =>
				annotationEditor.evaluate((element) => {
					const card = element.closest("[data-pdf-chrome]")!;
					const bounds = card.getBoundingClientRect();
					const viewport = card
						.closest("[data-pdf-viewport]")!
						.getBoundingClientRect();
					const hit = document.elementFromPoint(
						bounds.right - 8,
						bounds.top + 20,
					);
					return (
						bounds.width <= 194 &&
						bounds.right <= viewport.right &&
						bounds.left >= viewport.left &&
						!!hit &&
						card.contains(hit)
					);
				}),
			)
			.toBe(true);
	};
	await assertAnnotationFits();
	await page.setViewportSize({ width: 1100, height: 960 });
	await assertAnnotationFits();
	await annotationEditor.press("ControlOrMeta+Enter");
	await expect
		.poll(async () =>
			(await files(page)).some(
				(file) =>
					file.path.startsWith(`papers/${title}/marks/`) &&
					file.text.includes("Compact annotation remains accessible"),
			),
		)
		.toBe(true);
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.keyboard.press("Escape");
	const paperEditor = page
		.locator('[contenteditable="true"][role="textbox"]')
		.first();
	await expect(paperEditor).toBeVisible();
	await paperEditor.click();
	await paperEditor.press("ControlOrMeta+End");
	await paperEditor.press("Enter");
	await paperEditor.pressSequentially(
		"Paper note saved in the original editor.",
	);
	const paperNote = `papers/${title}/NOTES.md`;
	await expect
		.poll(
			async () =>
				(await files(page)).find((file) => file.path === paperNote)?.text,
		)
		.toContain("Paper note saved");
	await synchronize(page, paperNote);
	if (
		!(await page
			.locator("[data-agent-composer-input][contenteditable]")
			.isVisible())
	)
		await page
			.getByRole("button", { name: "Show right sidebar", exact: true })
			.click();
	await expect(
		page.locator("[data-agent-composer-input][contenteditable]"),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Hide right sidebar", exact: true })
		.click();

	const noteName = `${prefix}-sync.md`;
	const path = `notes/${noteName}`;
	await importFile(
		page,
		"Import files to notes",
		noteName,
		Buffer.from("# Device sync\n\nInitial note.\n"),
		"text/markdown",
	);
	let editorA = await openNote(page, noteName);
	await synchronize(page, path);
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
	const deviceB = await browser.newContext({
		viewport: { width: 1440, height: 960 },
	});
	const pageB = await deviceB.newPage();
	// newContext intentionally has independent cookies, IndexedDB and localStorage.
	await pageB.goto(new URL("/", page.url()).href);
	await pageB.getByLabel("Access password").fill(password);
	await pageB.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(
		pageB.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible({ timeout: 60000 });
	await finishInitialSetup(pageB);
	await expect(
		pageB.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible();
	await expect
		.poll(async () => (await files(pageB)).some((file) => file.path === path))
		.toBe(true);
	const editorB = await openNote(pageB, noteName);

	await page.context().setOffline(true);
	await editorA.click();
	await editorA.press("ControlOrMeta+End");
	await editorA.press("Enter");
	await editorA.pressSequentially("Device A offline contribution.");
	await expect
		.poll(
			async () => (await files(page)).find((file) => file.path === path)?.text,
		)
		.toContain("Device A offline contribution");
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible();
	editorA = await openNote(page, noteName);
	await expect(editorA).toContainText("Device A offline contribution");
	await page.getByRole("tab", { name: title, exact: true }).click();
	await expect
		.poll(() =>
			page
				.locator('img[src^="blob:"]')
				.evaluateAll((images) =>
					images.some(
						(image) => (image as HTMLImageElement).naturalWidth > 100,
					),
				),
		)
		.toBe(true);
	editorA = await openNote(page, noteName);

	await editorB.click();
	await editorB.press("ControlOrMeta+End");
	await editorB.press("Enter");
	await editorB.pressSequentially("Device B online contribution.");
	await expect
		.poll(
			async () => (await files(pageB)).find((file) => file.path === path)?.text,
		)
		.toContain("Device B online contribution");
	await synchronize(pageB, path);
	await page.context().setOffline(false);
	await expect
		.poll(
			async () =>
				(await files(page))
					.filter(
						(file) =>
							file.path.startsWith("Conflicts/") && file.path.includes(prefix),
					)
					.some((file) => file.text.includes("Device A offline contribution")),
			{ timeout: 45_000 },
		)
		.toBe(true);
	await expect
		.poll(
			async () => (await files(page)).find((file) => file.path === path)?.text,
		)
		.toContain("Device B online contribution");

	const conflict = (await files(page)).find(
		(file) => file.path.startsWith("Conflicts/") && file.path.endsWith(path),
	);
	expect(conflict?.text).toContain("Device A offline contribution");
	await synchronize(page, conflict!.path);
	await pageB.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect
		.poll(
			async () =>
				(await files(pageB)).find((file) => file.path === conflict!.path)?.text,
			{ timeout: 120_000 },
		)
		.toContain("Device A offline contribution");

	await page.getByRole("button", { name: "Export", exact: true }).click();
	const download = page.waitForEvent("download");
	await page
		.getByRole("menuitem", { name: "Download full backup ZIP" })
		.click();
	const backup = await download;
	expect(backup.suggestedFilename()).toMatch(/\.zip$/);
	const backupBytes = await readFile((await backup.path())!);
	await importFile(
		page,
		"Restore backup ZIP",
		"restore.zip",
		backupBytes,
		"application/zip",
	);
	await expect(
		page.getByText("Import completed", { exact: true }).last(),
	).toBeVisible();
	expect(errors).toEqual([]);
	await deviceB.close();
});

// UI fixture only: real Worker protocol requests are tested independently.
test("original Agent uses documents and Skills, writes notes and restores history offline", async ({
	page,
}) => {
	test.setTimeout(180000);
	const prompt = `Summarize-${Date.now()}`;
	const notePath = `notes/${prompt}-result.md`;
	let received: any;
	let step = 0;
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("crash", () => errors.push("Browser renderer crashed"));
	await page.route("**/api/ai/agent", async (route) => {
		received = route.request().postDataJSON();
		step++;
		const events =
			step === 1
				? [
						{
							type: "tool_call",
							call: {
								id: "write-1",
								name: "write_note",
								arguments: JSON.stringify({
									path: notePath,
									content: "# Fixture note\n\nThe measured value is 42.",
									expectedText: null,
								}),
							},
						},
						{ type: "done", reason: "tool_calls" },
					]
				: [
						{ type: "delta", text: "Fixture answer with evidence." },
						{ type: "done", reason: "stop" },
					];
		await route.fulfill({
			contentType: "text/event-stream",
			body: events
				.map((event) => `data: ${JSON.stringify(event)}\n\n`)
				.join(""),
		});
	});
	await login(page);
	const name = `${prefix}-ai.md`;
	await importFile(
		page,
		"Import files to notes",
		name,
		Buffer.from(
			"# Device sync\n\nDocument evidence: the measured value is 42.\n",
		),
		"text/markdown",
	);
	await openNote(page, name);
	const choosePermission = async (label: string) => {
		await page
			.getByRole("toolbar", { name: "Workspace storage" })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		await page.getByRole("button", { name: "Agent", exact: true }).click();
		const control = page.locator("#agent-perm");
		const previous = await control.innerText();
		await control.click();
		await page.getByRole("option", { name: label, exact: true }).click();
		await page.keyboard.press("Escape");
		return previous;
	};
	const previousPermission = await choosePermission("Ask every time");
	const composer = page.locator("[data-agent-composer-input][contenteditable]");
	await expect(
		page.getByRole("button", { name: /^(Show|Hide) right sidebar$/ }),
	).toBeVisible();
	if (
		await page
			.getByRole("button", { name: "Show right sidebar", exact: true })
			.isVisible()
	)
		await page
			.getByRole("button", { name: "Show right sidebar", exact: true })
			.click();
	const imagePicker = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Attach image", exact: true }).click();
	await (await imagePicker).setFiles({
		name: "pixel.png",
		mimeType: "image/png",
		buffer: Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
			"base64",
		),
	});
	await composer.fill("$paper-reader");
	await page.locator("#agent-skill-menu").getByRole("option").first().click();
	await composer.press("End");
	await composer.pressSequentially(` ${prompt}`);
	await composer.press("Enter");
	const permission = page.getByRole("dialog", { name: "Agent permission" });
	await expect(permission).toBeVisible();
	await expect(permission).toContainText("The measured value is 42");
	await permission
		.getByRole("button", { name: "Allow once", exact: true })
		.click();
	await expect(page.locator("[data-agent-panel]")).toContainText(
		"Fixture answer with evidence.",
	);
	// Completion is emitted after the durable checkpoint, not after the last text chunk.
	await expect(
		page.getByRole("button", { name: "Start a new conversation", exact: true }),
	).toBeEnabled({ timeout: 60000 });
	expect(JSON.stringify(received.messages)).toContain("measured value is 42");
	expect(received.instructions).toContain("Problem & Motivation");
	expect(received.messages[0].images[0].mimeType).toBe("image/png");
	expect(received.messages.at(-1).content).toContain('"saved":true');
	await expect
		.poll(
			async () =>
				(await files(page)).find((file) => file.path === notePath)?.text,
		)
		.toContain("measured value is 42");
	await expect
		.poll(async () => {
			const saved = (await files(page)).filter(
				(file) =>
					file.path.includes("/agent-sessions/") && file.text.includes(prompt),
			);
			return {
				errors,
				sessions: saved.map((file) => ({
					path: file.path,
					complete: file.text.includes("Fixture answer"),
				})),
			};
		})
		.toMatchObject({
			errors: [],
			sessions: expect.arrayContaining([
				expect.objectContaining({ complete: true }),
			]),
		});
	// A second user turn must retain both the first prompt and actual tool result.
	await composer.fill("Follow up on the same evidence");
	await composer.press("Enter");
	await expect.poll(() => step, { timeout: 60000 }).toBe(3);
	expect(JSON.stringify(received.messages)).toContain(prompt);
	expect(
		received.messages.some(
			(message: { role: string }) => message.role === "tool",
		),
	).toBe(true);
	await choosePermission(previousPermission);
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await page.context().setOffline(true);
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: /^(Show|Hide) right sidebar$/ }),
	).toBeVisible();
	if (
		await page
			.getByRole("button", { name: "Show right sidebar", exact: true })
			.isVisible()
	)
		await page
			.getByRole("button", { name: "Show right sidebar", exact: true })
			.click();
	await page
		.getByRole("button", { name: "Open chat history", exact: true })
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button")
		.filter({ hasText: prompt })
		.click();
	await expect(page.locator("[data-agent-panel]")).toContainText(
		"Fixture answer with evidence.",
	);
	await page
		.getByRole("button", { name: "Chain of Thought", exact: true })
		.click();
	const review = page.locator("[data-agent-note-review]");
	await expect(review).toContainText(notePath);
	await review.getByRole("button", { name: "Revert", exact: true }).click();
	await expect(review).toContainText("Reverted");
	await expect
		.poll(
			async () =>
				(await files(page)).find((file) => file.path === notePath)?.deleted,
		)
		.toBe(1);
	await page.context().setOffline(false);
	await synchronize(page, notePath);
	expect(errors).toEqual([]);
});
