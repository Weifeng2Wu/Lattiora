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
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toBeVisible({ timeout: 90000 });
	await finishInitialSetup(page, { stayOnHome: true });
}
async function customize(page: Page, width: string, all = true) {
	await page
		.getByRole("button", { name: "Customize home", exact: true })
		.click();
	const dialog = page.getByRole("dialog", { name: "Customize home" });
	if (all)
		for (const box of await dialog.getByRole("checkbox").all())
			await box.check();
	for (const select of await dialog.getByRole("combobox").all())
		await select.selectOption(width);
	return dialog;
}
async function save(page: Page) {
	const dialog = page.getByRole("dialog", { name: "Customize home" });
	await dialog
		.getByRole("button", { name: "Save layout", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
}
const handle = (page: Page, name: string) =>
	page.getByRole("button", {
		name: `Drag ${name} to reorder (or use arrow keys)`,
		exact: true,
	});
const order = (page: Page) =>
	page
		.locator("[data-home-widget]")
		.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute("data-home-widget")),
		);
async function savedOrder(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const r = indexedDB.open("agentero-cloud-v1");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		const file = await new Promise<{ data: Blob }>((resolve, reject) => {
			const r = db
				.transaction("files")
				.objectStore("files")
				.get(".agentero/home/settings.json");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		db.close();
		return JSON.parse(await file.data.text()).widgets.map(
			(item: { id: string }) => item.id,
		);
	});
}
async function startDrag(page: Page, source: string, target: string) {
	await handle(page, source).scrollIntoViewIfNeeded();
	const a = await handle(page, source).boundingBox();
	const b = await page.locator(`[data-home-widget="${target}"]`).boundingBox();
	if (!a || !b) throw new Error("Missing drag geometry");
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 8, {
		steps: 3,
	});
	await page.mouse.move(b.x + b.width / 2, b.y + 45, { steps: 12 });
}

test.beforeEach(() =>
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Uses isolated local settings"),
);

test("home widget dragging and keyboard ordering preserve input, save offline and synchronize", async ({
	page,
	context,
	browser,
}) => {
	test.setTimeout(240000);
	await login(page);
	await customize(page, "1");
	await save(page);
	const initial = await savedOrder(page);
	await handle(page, "Weather").press("Home");
	await expect
		.poll(() => savedOrder(page))
		.toEqual(["weather", ...initial.filter((id: string) => id !== "weather")]);
	await handle(page, "Clock and date").press("Home");
	await expect.poll(async () => (await savedOrder(page))[0]).toBe("clock");
	const before = await savedOrder(page);
	await startDrag(page, "Weather", "clock");
	await expect.poll(() => savedOrder(page)).toEqual(before);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(() => order(page)).toEqual(before);
	await expect(
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toContainText("Offline ready", { timeout: 90000 });
	await context.setOffline(true);
	await startDrag(page, "Weather", "clock");
	await page.mouse.up();
	const after = ["weather", ...before.filter((id: string) => id !== "weather")];
	await expect.poll(() => savedOrder(page)).toEqual(after);
	await page.reload();
	await expect.poll(() => order(page)).toEqual(after);
	const input = page.getByRole("textbox", {
		name: "Catch a thought…",
		exact: true,
	});
	await input.fill("Draft kept while moving cards");
	await handle(page, "Quick capture").press("Home");
	await expect(input).toHaveValue("Draft kept while moving cards");
	await expect(handle(page, "Quick capture")).toBeFocused();
	const final = await savedOrder(page);
	await context.setOffline(false);
	const sync = page.getByRole("button", { name: "Sync now", exact: true });
	await expect(sync).toBeEnabled({ timeout: 90000 });
	await sync.click();
	await expect(sync).toBeEnabled({ timeout: 90000 });
	const mobile = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
	});
	try {
		const second = await mobile.newPage();
		await login(second);
		await expect.poll(() => order(second)).toEqual(final);
		await expect(handle(second, "Quick capture")).toHaveCSS("opacity", "1");
		const target = second.locator('[data-home-widget="weather"]');
		await target.scrollIntoViewIfNeeded();
		await handle(second, "Quick capture").scrollIntoViewIfNeeded();
		const a = await handle(second, "Quick capture").boundingBox();
		const b = await target.boundingBox();
		if (!a || !b) throw new Error("Missing touch geometry");
		const cdp = await mobile.newCDPSession(second);
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }],
		});
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x: a.x + a.width / 2 + 30, y: a.y + a.height / 2 + 30 }],
		});
		await expect(second.locator('[data-home-widget="capture"]')).toHaveClass(
			/opacity-40/,
		);
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x: b.x + b.width / 2, y: b.y + 45 }],
		});
		await expect(target).toHaveClass(/ring-2/);
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await expect
			.poll(() => savedOrder(second))
			.toEqual([
				"weather",
				"capture",
				...final.filter((id: string) => id !== "weather" && id !== "capture"),
			]);
	} finally {
		await mobile.close();
	}
});

test("all home widgets adapt to small, medium and full widths inside narrow containers", async ({
	page,
}) => {
	test.setTimeout(240000);
	await page.route("**/api/weather/cities?**", (route) =>
		route.fulfill({
			json: {
				cities: [
					{
						name: "Newcastle upon Tyne, England, United Kingdom",
						latitude: 54.98,
						longitude: -1.61,
					},
				],
			},
		}),
	);
	await page.route("**/api/weather?**", (route) =>
		route.fulfill({
			json: {
				temperature: -12,
				high: -8,
				low: -17,
				code: 71,
				fetchedAt: Date.now(),
			},
		}),
	);
	await login(page);
	const dialog = await customize(page, "1");
	await dialog.getByLabel("Search city…").fill("Newcastle");
	await dialog.getByRole("button", { name: "Search", exact: true }).click();
	await dialog
		.getByRole("button", {
			name: "Newcastle upon Tyne, England, United Kingdom",
			exact: true,
		})
		.click();
	await save(page);
	await handle(page, "Clock and date").press("Home");
	await expect.poll(async () => (await savedOrder(page))[0]).toBe("clock");
	await handle(page, "Weather").press("Home");
	await page
		.getByLabel("Catch a thought…", { exact: true })
		.fill(`A long idea without spaces: ${"research".repeat(100)}`);
	const task = `Responsive task ${"unbroken".repeat(30)}`;
	await page.getByLabel("Add a task…", { exact: true }).fill(task);
	await page.getByRole("button", { name: "Add task", exact: true }).click();
	await expect(
		page.getByRole("checkbox", { name: `Complete ${task}`, exact: true }),
	).toBeVisible();
	for (const width of ["1", "2", "4"]) {
		if (width !== "1") {
			await customize(page, width);
			await save(page);
		}
		for (const container of [320, 600, 1100]) {
			await page
				.locator("[data-home-scroll]")
				.evaluate((el: HTMLElement, size) => {
					el.style.maxWidth = `${size}px`;
				}, container);
			await expect
				.poll(() =>
					page.locator("[data-home-widget]").evaluateAll((nodes) =>
						nodes.flatMap((node) => {
							const card = node.lastElementChild as HTMLElement;
							return card.scrollWidth > card.clientWidth + 1 ||
								Math.abs(
									card.getBoundingClientRect().height -
										node.getBoundingClientRect().height,
								) > 1
								? [node.getAttribute("data-home-widget")]
								: [];
						}),
					),
				)
				.toEqual([]);
			await expect(page.locator("[data-home-widget]")).toHaveCount(13);
			if (container === 1100 && width !== "4") {
				const weather = await page
					.locator('[data-home-widget="weather"]')
					.boundingBox();
				const clock = await page
					.locator('[data-home-widget="clock"]')
					.boundingBox();
				if (!weather || !clock) throw new Error("Missing card geometry");
				expect(Math.abs(weather.y - clock.y)).toBeLessThan(1);
				expect(Math.abs(weather.height - clock.height)).toBeLessThan(1);
			}
		}
	}
	await page.locator("[data-home-scroll]").evaluate((el: HTMLElement) => {
		el.style.maxWidth = "";
		el.scrollTop = 0;
	});
	await customize(page, "1");
	await save(page);
	await page.screenshot({ path: test.info().outputPath("home-adaptive.png") });
});
