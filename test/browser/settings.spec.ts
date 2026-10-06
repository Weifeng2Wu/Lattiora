import { expect, type Page, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

// Uses the shared preferences/key slots; live account data must never be overwritten by fixtures.
test.skip(
	Boolean(process.env.CLOUD_E2E_URL),
	"Settings fixtures use the local isolated Worker only",
);
const password = "local-development-password-32-chars";
async function login(page: Page) {
	await page.goto("/");
	await page.getByLabel("Access password").fill(password);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.waitFor();
	await finishInitialSetup(page);
}
async function preferences(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const r = indexedDB.open("agentero-cloud-v1", 1);
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		const record = await new Promise<
			{ data?: Blob; dirty?: boolean; version?: number } | undefined
		>((resolve, reject) => {
			const r = db
				.transaction("files")
				.objectStore("files")
				.get(".agentero/settings.json");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		db.close();
		return record?.data
			? {
					settings: JSON.parse(await record.data.text()),
					dirty: record.dirty,
					version: record.version,
				}
			: null;
	});
}

test("sidebar protects file extensions until enabled in settings, including offline reload", async ({
	page,
	context,
}) => {
	test.setTimeout(180000);
	await login(page);
	const settingsButton = page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true });
	const toggle = page.getByRole("switch", {
		name: "Allow changing file extensions",
		exact: true,
	});
	const openSettings = async () => {
		await settingsButton.click();
		await page.getByRole("button", { name: "General", exact: true }).click();
	};
	const closeSettings = () =>
		page.getByRole("button", { name: "Close", exact: true }).click();
	await openSettings();
	await expect(toggle).not.toBeChecked();
	await closeSettings();

	const prefix = `00-rename-${Date.now()}`;
	const original = `${prefix}.draft.md`;
	const renamed = `${prefix}.revised.txt.md`;
	const visual = `${prefix}.mindmap.json`;
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const picker = page.waitForEvent("filechooser");
	await page
		.getByRole("menuitem", { name: "Import files to notes", exact: true })
		.click();
	await (await picker).setFiles(
		[original, visual].map((name) => ({
			name,
			mimeType: "text/plain",
			buffer: Buffer.from("Rename fixture\n"),
		})),
	);
	const sidebar = page.locator("[data-vault-sidebar]");
	const notes = sidebar.getByRole("treeitem", { name: "notes", exact: true });
	if ((await notes.getAttribute("aria-expanded")) !== "true")
		await notes.click();
	const input = sidebar.getByRole("textbox", { name: "Rename…", exact: true });
	const startRename = async (name: string) => {
		await sidebar.getByText(name, { exact: true }).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
		await expect(input).toBeFocused();
	};
	await startRename(`${prefix}.draft`);
	await expect(input).toHaveValue(`${prefix}.draft`);
	await expect(sidebar.getByText(".md", { exact: true })).toBeHidden();
	await input.fill("");
	await input.press("Enter");
	await expect(
		sidebar.getByText(`${prefix}.draft`, { exact: true }),
	).toBeVisible();
	await startRename(`${prefix}.draft`);
	await input.fill("../invalid");
	await input.press("Enter");
	await expect(input).toHaveAttribute("aria-invalid", "true");
	await input.fill(`${prefix}.revised.txt`);
	await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
	await expect(input).toBeVisible();
	await input.press("Enter");
	await expect(
		sidebar.getByText(`${prefix}.revised.txt`, { exact: true }),
	).toBeVisible();

	await startRename(prefix);
	await expect(input).toHaveValue(prefix);
	await expect(
		sidebar.getByText(".mindmap.json", { exact: true }),
	).toBeHidden();
	await input.fill(`${prefix}-map`);
	await input.press("Enter");
	await expect(
		sidebar.getByText(`${prefix}-map`, { exact: true }),
	).toBeVisible();

	await notes.click({ button: "right" });
	await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
	const folderInput = sidebar.getByRole("textbox", {
		name: "New folder",
		exact: true,
	});
	await folderInput.fill(`${prefix}.folder`);
	await folderInput.press("Enter");
	await startRename(`${prefix}.folder`);
	await expect(input).toHaveValue(`${prefix}.folder`);
	await input.fill(`${prefix}.directory`);
	await input.press("Enter");
	await expect(
		sidebar.getByText(`${prefix}.directory`, { exact: true }),
	).toBeVisible();

	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 100000 });
	await context.setOffline(true);
	await openSettings();
	await toggle.check();
	await expect
		.poll(
			async () => (await preferences(page))?.settings.allowFileExtensionRename,
		)
		.toBe(true);
	await closeSettings();
	await page.reload();
	await openSettings();
	await expect(toggle).toBeChecked();
	await closeSettings();
	if ((await notes.getAttribute("aria-expanded")) !== "true")
		await notes.click();
	await startRename(renamed);
	await expect(input).toHaveValue(renamed);
	await input.fill(`${prefix}.txt`);
	await input.press("Enter");
	await expect(
		sidebar.getByText(`${prefix}.txt`, { exact: true }),
	).toBeVisible();
	await openSettings();
	await toggle.uncheck();
	await expect
		.poll(
			async () => (await preferences(page))?.settings.allowFileExtensionRename,
		)
		.toBe(false);
	await closeSettings();
	await startRename(prefix);
	await expect(input).toHaveValue(prefix);
	await expect(sidebar.getByText(".txt", { exact: true })).toBeHidden();
	await input.press("Escape");
	await expect(sidebar.getByText(prefix, { exact: true })).toBeVisible();
	await context.setOffline(false);
});

test("interface scale previews during dragging and applies only on release", async ({
	page,
}) => {
	await login(page);
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Appearance", exact: true }).click();
	const slider = page.getByRole("slider", {
		name: "Interface scale",
		exact: true,
	});
	await slider.fill("100");
	await expect(page.locator("html")).toHaveCSS("font-size", "16px");
	// Wait for dialog positioning before taking coordinates for a real mouse drag.
	await slider.hover();
	const bounds = await slider.boundingBox();
	if (!bounds) throw new Error("Missing scale slider");
	await page.mouse.move(
		bounds.x + bounds.width * 0.29,
		bounds.y + bounds.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		bounds.x + bounds.width * 0.75,
		bounds.y + bounds.height / 2,
		{ steps: 8 },
	);
	// Pause longer than the old debounce while still holding the thumb.
	await page.waitForTimeout(400);
	const preview = Number(await slider.inputValue());
	expect(preview).toBeGreaterThan(120);
	await expect(page.locator("html")).toHaveCSS("font-size", "16px");
	expect((await slider.boundingBox())?.width).toBeCloseTo(bounds.width);
	await page.mouse.up();
	await expect
		.poll(async () => (await preferences(page))?.settings.uiScale)
		.toBe(preview / 100);
	await expect(page.locator("html")).toHaveCSS(
		"font-size",
		`${(16 * preview) / 100}px`,
	);
	await slider.press("ArrowLeft");
	await expect
		.poll(async () => (await preferences(page))?.settings.uiScale)
		.toBe((preview - 1) / 100);
	await slider.fill("100");
});

test("original appearance UI persists offline and synchronizes with a second device", async ({
	browser,
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await login(page);
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Appearance", exact: true }).click();
	await expect(
		page.locator("[data-settings-content] button[aria-pressed]"),
	).toHaveCount(37);
	await page
		.getByRole("button", { name: "Use Catppuccin theme", exact: true })
		.click();
	const slider = page.getByRole("slider", {
		name: "Interface scale",
		exact: true,
	});
	await slider.fill("112");
	await expect
		.poll(async () => (await preferences(page))?.settings.uiScale)
		.toBe(1.12);
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 100000 });
	await page.context().setOffline(true);
	await page.reload();
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Appearance", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Use Catppuccin theme", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(slider).toHaveValue("112");
	await page
		.getByRole("button", { name: "Use Graphite theme", exact: true })
		.click();
	await expect
		.poll(async () => (await preferences(page))?.settings.uiTheme)
		.toBe("graphite");
	await page.context().setOffline(false);
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect.poll(async () => (await preferences(page))?.dirty).toBe(false);
	const second = await browser.newContext();
	try {
		const device = await second.newPage();
		await login(device);
		await expect
			.poll(async () => (await preferences(device))?.settings.uiTheme)
			.toBe("graphite");
		await device
			.getByRole("toolbar", { name: "Workspace storage", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		await device
			.getByRole("button", { name: "Appearance", exact: true })
			.click();
		await expect(
			device.getByRole("button", { name: "Use Graphite theme", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
	} finally {
		await second.close();
	}
	expect(errors).toEqual([]);
});

test("original translation provider card saves an independent key without persisting plaintext", async ({
	page,
}) => {
	const probes: any[] = [];
	let unavailable = false;
	await page.route("**/api/translate", async (route) => {
		probes.push(route.request().postDataJSON());
		await route.fulfill({
			status: unavailable ? 502 : 200,
			json: unavailable ? { error: "providerError" } : { text: "你好" },
		});
	});
	await login(page);
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Translate", exact: true }).click();
	await page
		.locator("#translate-provider-openaiCompatible-api-key")
		.fill("browser-fixture-private-key");
	await page
		.locator("#translate-provider-openaiCompatible-base-url")
		.fill("https://translation.test/v1");
	await page
		.locator("#translate-provider-openaiCompatible-model")
		.fill("translator-model");
	await page
		.getByRole("button", { name: "Confirm", exact: true })
		.last()
		.click();
	await expect(
		page.locator("#translate-provider-openaiCompatible-api-key"),
	).toHaveValue(/^\*+$/);
	await expect
		.poll(() => probes.some((p) => p.provider === "openaiCompatible"))
		.toBe(true);
	await page
		.locator("#translate-custom-prompt")
		.fill("Formal {{targetLang}}. Keep equations.");
	await expect
		.poll(
			async () => (await preferences(page))?.settings.translate.customPrompt,
		)
		.toBe("Formal {{targetLang}}. Keep equations.");
	const saved = await preferences(page);
	expect(JSON.stringify(saved)).not.toContain("browser-fixture-private-key");
	expect(saved?.settings.translate.providerConfigs.openaiCompatible.model).toBe(
		"translator-model",
	);
	const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
	expect(stored).not.toContain("browser-fixture-private-key");
	expect(probes.find((p) => p.provider === "openaiCompatible").apiKey).toMatch(
		/^\*+$/,
	);
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await page.reload();
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Translate", exact: true }).click();
	await expect(
		page
			.locator('[data-provider="openaiCompatible"]')
			.getByRole("status", { name: "Configured", exact: true }),
	).toHaveClass(/bg-emerald-500/);
	await page.getByRole("combobox").first().click();
	const tencent = page.getByRole("option", { name: /Tencent Transmart/ });
	await expect(
		tencent.getByRole("status", { name: "Configured", exact: true }),
	).toHaveClass(/bg-emerald-500/);
	await tencent.click();
	await expect(page.locator("#translate-free-endpoint")).toHaveValue(
		"https://transmart.qq.com",
	);
	await page
		.getByRole("button", { name: "Test connection", exact: true })
		.first()
		.click();
	await expect
		.poll(() =>
			probes.some(
				(p) =>
					p.provider === "tencenttransmart" &&
					p.baseUrl === "https://transmart.qq.com",
			),
		)
		.toBe(true);
	await expect(
		page
			.getByRole("combobox")
			.first()
			.getByRole("status", { name: "Available", exact: true }),
	).toHaveClass(/bg-emerald-500/);
	unavailable = true;
	await page
		.getByRole("button", { name: "Test connection", exact: true })
		.first()
		.click();
	await expect(
		page
			.getByRole("combobox")
			.first()
			.getByRole("status", { name: "Unavailable", exact: true }),
	).toHaveClass(/bg-destructive/);
	await page
		.locator("#translate-free-endpoint")
		.fill("https://custom-translation.example");
	await expect(
		page
			.getByRole("combobox")
			.first()
			.getByRole("status", { name: "Configured", exact: true }),
	).toHaveClass(/bg-emerald-500/);
	await page.screenshot({
		path: test.info().outputPath("translation-configured.png"),
	});
});

test("every configurable API card has a working Test connection action for its draft", async ({
	page,
}) => {
	const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
	for (const path of ["ai/probe", "parser/probe", "translate", "embedding"]) {
		await page.route(`**/api/${path}`, async (route) => {
			calls.push({ path, body: route.request().postDataJSON() });
			await route.fulfill({
				json:
					path === "translate"
						? { text: "你好" }
						: path === "embedding"
							? { vectors: [[1, 0]], dim: 2, latencyMs: 1 }
							: path === "parser/probe"
								? { jobId: "fixture" }
								: { ok: true },
			});
		});
	}
	await login(page);
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Agent", exact: true }).click();
	await page.locator("#cloud-api-key").fill("draft-model-secret");
	await page.locator("#cloud-model").fill("test-model");
	await page
		.locator('[data-settings-pane][data-active="true"] form')
		.getByRole("button", { name: "Test connection", exact: true })
		.click();
	await expect
		.poll(() =>
			calls.some((c) => c.path === "ai/probe" && c.body.model === "test-model"),
		)
		.toBe(true);
	await page
		.locator("#agent-embedding-base-url")
		.fill("https://embedding.test/v1");
	await page.locator("#agent-embedding-model").fill("embedding-test");
	await page.locator("#agent-embedding-api-key").fill("draft-embedding-secret");
	await page.locator("#agent-embedding-api-key").blur();
	await expect(page.locator("#agent-embedding-api-key")).toHaveValue(/^\*+$/);
	await page
		.locator('[data-settings-pane][data-active="true"]')
		.getByRole("button", { name: "Test connection", exact: true })
		.last()
		.click();
	await expect
		.poll(() =>
			calls.some(
				(c) => c.path === "embedding" && c.body.model === "embedding-test",
			),
		)
		.toBe(true);
	await page.getByRole("button", { name: "Layout", exact: true }).click();
	for (const provider of ["paddle", "mineru", "openaiCompatible"]) {
		await page
			.locator(`#layout-provider-${provider}-api-key`)
			.fill(`draft-${provider}-secret`);
		await page
			.locator(`[data-provider="${provider}"]`)
			.filter({ visible: true })
			.getByRole("button", { name: "Test connection", exact: true })
			.click();
		await expect
			.poll(() =>
				calls.some(
					(c) => c.path === "parser/probe" && c.body.provider === provider,
				),
			)
			.toBe(true);
	}
	await page.getByRole("button", { name: "Translate", exact: true }).click();
	for (const provider of [
		"deepl",
		"azure",
		"googleCloud",
		"openaiCompatible",
	]) {
		await page
			.locator(`#translate-provider-${provider}-base-url`)
			.fill(`https://${provider.toLowerCase()}.test`);
		await page
			.locator(`#translate-provider-${provider}-api-key`)
			.fill(`draft-${provider}-translation-secret`);
		if (provider === "azure")
			await page
				.locator(`#translate-provider-${provider}-region`)
				.fill("eastasia");
		if (provider === "openaiCompatible")
			await page
				.locator(`#translate-provider-${provider}-model`)
				.fill("translation-test");
		await page
			.locator(`[data-provider="${provider}"]`)
			.filter({ visible: true })
			.getByRole("button", { name: "Test connection", exact: true })
			.click();
		await expect
			.poll(() =>
				calls.some(
					(c) => c.path === "translate" && c.body.provider === provider,
				),
			)
			.toBe(true);
	}
	expect(JSON.stringify(await preferences(page))).not.toContain("draft-");
	const local = await page.evaluate(() => JSON.stringify({ ...localStorage }));
	expect(local).not.toContain("draft-");
	let scholarProbes = 0;
	await page.route("**/api/easyscholar", async (route) => {
		scholarProbes++;
		await route.fulfill({
			json: { code: 200, data: { officialRank: { all: { sci: "Q1" } } } },
		});
	});
	await page.getByRole("button", { name: "General", exact: true }).click();
	await page.locator("#easy-scholar-key").fill("browser-scholar-fixture");
	await page
		.getByRole("button", { name: "Confirm", exact: true })
		.filter({ visible: true })
		.click();
	await expect(page.locator("#easy-scholar-key")).toHaveValue(/^\*+$/);
	const scholarButton = page
		.locator("#easy-scholar-key")
		.locator("..")
		.getByRole("button", { name: "Test connection", exact: true });
	await expect(scholarButton).toBeEnabled();
	const count = scholarProbes;
	await scholarButton.click();
	await expect.poll(() => scholarProbes).toBeGreaterThan(count);
	expect(JSON.stringify(await preferences(page))).not.toContain(
		"browser-scholar-fixture",
	);
});

test("two devices preserve conflicting offline settings instead of silently overwriting", async ({
	browser,
	page,
}) => {
	const second = await browser.newContext();
	try {
		const other = await second.newPage();

		await login(page);
		await page
			.getByRole("toolbar", { name: "Workspace storage", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		await page.getByRole("button", { name: "Appearance", exact: true }).click();
		await page
			.getByRole("slider", { name: "Interface scale", exact: true })
			.fill("100");
		await expect
			.poll(async () => (await preferences(page))?.settings.uiScale)
			.toBe(1);
		await page.getByRole("button", { name: "Close", exact: true }).click();
		await page.getByRole("button", { name: "Sync now", exact: true }).click();
		await expect.poll(async () => (await preferences(page))?.dirty).toBe(false);
		await login(other);
		await expect
			.poll(async () => (await preferences(other))?.version)
			.toBe((await preferences(page))?.version);
		await expect
			.poll(async () => (await preferences(other))?.settings.uiScale)
			.toBe(1);
		await expect.poll(async () => Boolean(await preferences(other))).toBe(true);
		for (const device of [page, other]) {
			await device
				.getByRole("toolbar", { name: "Workspace storage", exact: true })
				.getByRole("button", { name: "Settings", exact: true })
				.click();
			await device
				.getByRole("button", { name: "Appearance", exact: true })
				.click();
		}
		// Both pages have loaded the same server revision before becoming disconnected.
		await expect.poll(async () => (await preferences(page))?.dirty).toBe(false);
		await expect
			.poll(async () => (await preferences(other))?.dirty)
			.toBe(false);
		const conflictStart = Date.now();
		await page.context().setOffline(true);
		await second.setOffline(true);
		await page
			.getByRole("slider", { name: "Interface scale", exact: true })
			.fill("113");
		await other
			.getByRole("slider", { name: "Interface scale", exact: true })
			.fill("114");
		await expect
			.poll(async () => (await preferences(page))?.settings.uiScale)
			.toBe(1.13);
		await expect
			.poll(async () => (await preferences(other))?.settings.uiScale)
			.toBe(1.14);
		await expect.poll(async () => (await preferences(page))?.dirty).toBe(true);
		await expect.poll(async () => (await preferences(other))?.dirty).toBe(true);
		await page.context().setOffline(false);
		await page.getByRole("button", { name: "Close", exact: true }).click();
		await page.getByRole("button", { name: "Sync now", exact: true }).click();
		await expect.poll(async () => (await preferences(page))?.dirty).toBe(false);
		await second.setOffline(false);
		await other.getByRole("button", { name: "Close", exact: true }).click();
		await other.getByRole("button", { name: "Sync now", exact: true }).click();
		const values = () =>
			other.evaluate(async (since) => {
				const db = await new Promise<IDBDatabase>((r) => {
					const q = indexedDB.open("agentero-cloud-v1");
					q.onsuccess = () => r(q.result);
				});
				const files = await new Promise<
					Array<{
						path: string;
						data: Blob | null;
						deleted: number;
						updated_at: number;
					}>
				>((r) => {
					const q = db.transaction("files").objectStore("files").getAll();
					q.onsuccess = () => r(q.result);
				});
				db.close();
				return Promise.all(
					files
						.filter(
							(f) =>
								!f.deleted &&
								f.data &&
								(f.path === ".agentero/settings.json" ||
									(f.path.startsWith("Conflicts/") &&
										f.updated_at >= since &&
										f.path.endsWith("/.agentero/settings.json"))),
						)
						.map(async (f) => JSON.parse(await f.data!.text()).uiScale),
				);
			}, conflictStart);
		await expect.poll(values).toEqual(expect.arrayContaining([1.13, 1.14]));
	} finally {
		await second.close();
	}
});

test("original setup wizard and feature tour can be replayed from settings", async ({
	page,
}) => {
	await login(page);
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Quick setup wizard", exact: true })
		.click();
	await page.getByRole("button", { name: "Start setup", exact: true }).click();
	await expect(page.getByText("Pick your look", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await expect(page.locator("#cloud-provider")).toBeVisible();
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await page.getByRole("button", { name: /Use configured AI/ }).click();
	await page
		.getByRole("button", {
			name: /Use (browser text regions|on-device layout model)/,
		})
		.click();
	await page.getByRole("button", { name: "Finish setup", exact: true }).click();
	await expect
		.poll(async () => (await preferences(page))?.settings.onboardingDone)
		.toBe(true);
	// Finishing first setup may start the automatic tour. Dismiss it before replay.
	const overlay = page.locator(".driver-popover");
	await overlay
		.waitFor({ state: "visible", timeout: 6000 })
		.catch(() => undefined);
	if (await overlay.isVisible())
		await page.locator(".driver-popover-close-btn").click();
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "Feature tour", exact: true }).click();
	await expect(overlay).toBeVisible();
	await expect(overlay).toContainText("Your library & vault");
	await page.locator(".driver-popover-close-btn").click();
	await expect
		.poll(async () => (await preferences(page))?.settings.featureTourDone)
		.toBe(true);
});
