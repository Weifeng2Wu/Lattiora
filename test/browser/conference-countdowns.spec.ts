import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("conference selections count down, survive failed refreshes and remain editable offline", async ({
	page,
}) => {
	test.setTimeout(180000);
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Uses local conference fixtures",
	);
	const now = Date.now();
	const date = (offset: number) =>
		new Date(now + offset * 86400000)
			.toISOString()
			.slice(0, 19)
			.replace("T", " ");
	const source = [
		{
			title: "CONF",
			description: "Conference for countdown testing",
			sub: "AI",
			rank: { ccf: "A" },
			confs: [
				{
					id: "conf30",
					year: 2030,
					link: "https://example.org/conf",
					timezone: "UTC",
					date: "June 2030",
					place: "Online",
					timeline: [{ deadline: date(2), abstract_deadline: date(-1) }],
				},
			],
		},
		{
			title: "LATER",
			description: "Multiple submission rounds",
			sub: "SE",
			rank: { ccf: "B" },
			confs: [
				{
					id: "later30",
					year: 2030,
					timezone: "UTC",
					timeline: [
						{ deadline: date(-2) },
						{ deadline: date(5), comment: "Second round" },
					],
				},
			],
		},
		{
			title: "PENDING",
			sub: "AI",
			rank: { ccf: "A" },
			confs: [
				{
					id: "pending30",
					year: 2030,
					timezone: "AoE",
					timeline: [{ deadline: "TBD" }],
				},
			],
		},
	];
	let unavailable = true;
	await page.route("**/api/feeds/fetch", async (route) => {
		if (
			route.request().postDataJSON()?.url !==
			"https://ccfddl.com/conference/allconf.json"
		)
			return route.continue();
		await route.fulfill({
			status: unavailable ? 502 : 200,
			contentType: "application/json",
			body: JSON.stringify(
				unavailable
					? { error: "feeds.fetch" }
					: { status: 200, body: JSON.stringify(source) },
			),
		});
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
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toBeVisible({ timeout: 90000 });
	await finishInitialSetup(page, { stayOnHome: true });
	const panel = page.getByRole("region", {
		name: "Conference deadlines",
		exact: true,
	});
	await expect(
		page
			.locator('[data-home-widget="conferences"]')
			.getByRole("region", { name: "Conference deadlines", exact: true }),
	).toBeVisible();
	await panel.getByRole("button", { name: "Choose conferences" }).click();
	const dialog = page.getByRole("dialog", { name: "Choose conferences" });
	await expect(dialog).toContainText(
		"Connect and refresh to load conferences.",
	);
	await page.keyboard.press("Escape");
	unavailable = false;
	await panel.getByRole("button", { name: "Refresh conferences" }).click();
	await expect(
		panel.getByRole("button", { name: "Refresh conferences" }),
	).toBeEnabled();
	await panel.getByRole("button", { name: "Choose conferences" }).click();
	await dialog
		.getByRole("combobox", { name: "CCF rank", exact: true })
		.selectOption("B");
	await expect(dialog.getByRole("checkbox")).toHaveCount(1);
	await dialog
		.getByRole("checkbox", { name: "LATER 2030", exact: true })
		.check();
	await dialog
		.getByRole("combobox", { name: "CCF rank", exact: true })
		.selectOption("");
	await dialog
		.getByRole("combobox", { name: "Research area" })
		.selectOption("AI");
	await expect(dialog.getByRole("checkbox")).toHaveCount(2);
	await dialog
		.getByRole("textbox", { name: "Search conferences…" })
		.fill("CONF");
	await expect(dialog.getByRole("checkbox")).toHaveCount(1);
	await dialog
		.getByRole("checkbox", { name: "CONF 2030", exact: true })
		.focus();
	await page.keyboard.press("Space");
	await dialog
		.getByRole("textbox", { name: "Search conferences…" })
		.fill("PENDING");
	await dialog
		.getByRole("checkbox", { name: "PENDING 2030", exact: true })
		.check();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(panel.getByRole("article").first()).toHaveAttribute(
		"aria-label",
		"CONF 2030",
	);
	const timer = panel.getByRole("timer", {
		name: "Countdown to CONF 2030",
		exact: true,
	});
	await expect(timer).toHaveText(/1days\d{2}:\d{2}:\d{2}/);
	const before = await timer.textContent();
	await expect(timer).not.toHaveText(before ?? "");
	await expect(
		panel.getByRole("article", { name: "CONF 2030", exact: true }),
	).not.toContainText("Abstract closed");
	await expect(
		panel
			.getByRole("article", { name: "LATER 2030", exact: true })
			.locator("time"),
	).toHaveAttribute(
		"datetime",
		new Date(`${date(5).replace(" ", "T")}Z`).toISOString(),
	);
	await expect(
		panel.getByRole("timer", {
			name: "Countdown to PENDING 2030",
			exact: true,
		}),
	).toHaveText("Deadline to be announced");
	await expect(
		panel.getByRole("link", { name: "CONF 2030", exact: true }),
	).toHaveAttribute("href", "https://example.org/conf");
	unavailable = true;
	await panel.getByRole("button", { name: "Refresh conferences" }).click();
	await expect(
		page
			.getByText(
				"Could not refresh conferences. Previously cached deadlines are kept.",
			)
			.first(),
	).toBeVisible();
	await expect(timer).toHaveText(/1days\d{2}:\d{2}:\d{2}/);
	await page.screenshot({
		path: test.info().outputPath("conferences-desktop.png"),
	});
	await expect(
		page.getByRole("toolbar", { name: "Workspace storage" }),
	).toContainText("Offline ready", { timeout: 90000 });
	await page.context().setOffline(true);
	await page.reload();
	await expect(timer).toHaveText(/1days\d{2}:\d{2}:\d{2}/, { timeout: 90000 });
	await panel
		.getByRole("button", { name: "Remove LATER 2030", exact: true })
		.click();
	await expect(panel.getByRole("article")).toHaveCount(2);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(panel.getByRole("article")).toHaveCount(2, { timeout: 90000 });
	await expect(
		panel.getByRole("article", { name: "LATER 2030", exact: true }),
	).toHaveCount(0);
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		)
		.toBe(true);
	await page.screenshot({
		path: test.info().outputPath("conferences-mobile.png"),
	});
	await panel.getByRole("button", { name: "Choose conferences" }).click();
	await expect(
		dialog.getByRole("checkbox", { name: "CONF 2030", exact: true }),
	).toBeChecked();
});
