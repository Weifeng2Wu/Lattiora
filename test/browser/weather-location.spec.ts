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
async function city(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const r = indexedDB.open("agentero-cloud-v1");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		const file = await new Promise<{ data: Blob } | undefined>(
			(resolve, reject) => {
				const r = db
					.transaction("files")
					.objectStore("files")
					.get(".agentero/home/settings.json");
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			},
		);
		db.close();
		return file ? (JSON.parse(await file.data.text()).city ?? null) : null;
	});
}
async function customize(page: Page) {
	await page
		.getByRole("button", { name: "Customize home", exact: true })
		.click();
	return page.getByRole("dialog", { name: "Customize home", exact: true });
}
async function save(page: Page) {
	await page.getByRole("button", { name: "Save layout", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "Customize home", exact: true }),
	).toHaveCount(0);
}
test.beforeEach(() =>
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Uses isolated location fixtures",
	),
);

test("weather requests location only on demand, saves approximate coordinates and restores cached weather offline", async ({
	page,
	context,
}) => {
	test.setTimeout(180000);
	await page.addInitScript(() => {
		const scope = window as unknown as { geoCalls: number };
		scope.geoCalls = 0;
		const get = navigator.geolocation.getCurrentPosition.bind(
			navigator.geolocation,
		);
		navigator.geolocation.getCurrentPosition = (...args) => {
			scope.geoCalls++;
			get(...args);
		};
	});
	const requests: string[] = [];
	await page.route("**/api/weather?**", (route) => {
		requests.push(route.request().url());
		return route.fulfill({
			json: {
				temperature: 27,
				high: 29,
				low: 22,
				code: 1,
				fetchedAt: Date.now(),
			},
		});
	});
	await context.setGeolocation({
		latitude: 35.689487,
		longitude: 139.691711,
		accuracy: 75,
	});
	await login(page);
	await context.grantPermissions(["geolocation"], {
		origin: new URL(page.url()).origin,
	});
	await expect
		.poll(() =>
			page.evaluate(() => (window as unknown as { geoCalls: number }).geoCalls),
		)
		.toBe(0);
	const dialog = await customize(page);
	await dialog.getByRole("checkbox", { name: "Weather", exact: true }).check();
	await dialog
		.getByRole("button", { name: "Use current location", exact: true })
		.click();
	await expect(
		dialog.getByText("Located place", { exact: true }),
	).toBeVisible();
	await save(page);
	await expect
		.poll(() => city(page))
		.toEqual({ name: "Located place", latitude: 35.69, longitude: 139.69 });
	await expect
		.poll(() =>
			requests.some((value) =>
				value.includes("latitude=35.69&longitude=139.69"),
			),
		)
		.toBe(true);
	await expect(page.locator('[data-home-widget="weather"]')).toContainText(
		"27°",
	);
	await expect(
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toContainText("Offline ready", { timeout: 90000 });
	await context.setOffline(true);
	await page.reload();
	await expect(page.locator('[data-home-widget="weather"]')).toContainText(
		"Located place",
	);
	await expect(page.locator('[data-home-widget="weather"]')).toContainText(
		"27°",
	);
	await expect
		.poll(() =>
			page.evaluate(() => (window as unknown as { geoCalls: number }).geoCalls),
		)
		.toBe(0);
});

test("denied or timed out location preserves the saved city and late callbacks cannot change a reopened dialog", async ({
	page,
	context,
}) => {
	test.setTimeout(180000);
	await login(page);
	await context.grantPermissions([], { origin: new URL(page.url()).origin });
	await expect
		.poll(() =>
			page.evaluate(
				async () =>
					(await navigator.permissions.query({ name: "geolocation" })).state,
			),
		)
		.toBe("denied");
	const previous = await city(page);
	const dialog = await customize(page);
	await dialog
		.getByRole("button", { name: "Use current location", exact: true })
		.click();
	await expect(
		page.getByText(
			"Location access was denied. Allow it in your browser settings or choose a city manually.",
			{ exact: true },
		),
	).toBeVisible();
	await save(page);
	await expect.poll(() => city(page)).toEqual(previous);
	await page.evaluate(() => {
		navigator.geolocation.getCurrentPosition = (_success, error) =>
			error?.({ code: 3 } as GeolocationPositionError);
	});
	await customize(page);
	await dialog
		.getByRole("button", { name: "Use current location", exact: true })
		.click();
	await expect(
		page.getByText("Location timed out. Try again or choose a city manually.", {
			exact: true,
		}),
	).toBeVisible();
	await save(page);
	await expect.poll(() => city(page)).toEqual(previous);
	await page.evaluate(() => {
		navigator.geolocation.getCurrentPosition = (success) => {
			(
				window as unknown as { delayedLocation: PositionCallback }
			).delayedLocation = success;
		};
	});
	await customize(page);
	await dialog
		.getByRole("button", { name: "Use current location", exact: true })
		.click();
	await expect(
		dialog.getByRole("button", { name: "Save layout", exact: true }),
	).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await customize(page);
	await page.evaluate(() =>
		(
			window as unknown as { delayedLocation: PositionCallback }
		).delayedLocation({
			coords: { latitude: 0, longitude: 0 },
		} as GeolocationPosition),
	);
	await expect(
		dialog.getByRole("button", { name: "Use current location", exact: true }),
	).toBeEnabled();
	await save(page);
	await expect.poll(() => city(page)).toEqual(previous);
});
