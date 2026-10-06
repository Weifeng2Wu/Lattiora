import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("configured Zotero metadata service probes draft keys and imports ISBN through the original magic wand", async ({
	page,
}) => {
	test.skip(
		Boolean(process.env.CLOUD_E2E_URL),
		"Local service fixture and vault",
	);
	test.setTimeout(180000);
	const title = `translator-${Date.now()}`;
	const isbn = `ISBN:9780123456789`;
	const calls: Record<string, unknown>[] = [];
	await page.route("**/api/translator", async (route) => {
		const body = route.request().postDataJSON();
		calls.push(body);
		await route.fulfill({
			json: {
				exact: true,
				papers: [
					{
						id: title,
						title,
						authors: ["Researcher"],
						type: "other",
						meta_source: "translator",
					},
				],
			},
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
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible({ timeout: 90000 });
	await finishInitialSetup(page);
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "General", exact: true }).click();
	const endpoint = page.getByRole("textbox", {
		name: "Translator service URL",
		exact: true,
	});
	const key = page.getByLabel("Translator API key (optional)", { exact: true });
	const card = endpoint.locator("../../..");
	const previous = await endpoint.inputValue();
	await expect(endpoint).toHaveValue("https://translate.manubot.org");
	await expect(
		page.getByRole("switch", {
			name: "Enable Zotero metadata service",
			exact: true,
		}),
	).toBeChecked();
	await endpoint.fill("https://translator.example/base");
	await key.fill("translator-draft-secret");
	await card
		.getByRole("button", { name: "Test connection", exact: true })
		.click();
	await expect
		.poll(() =>
			calls.some(
				(c) =>
					c.operation === "probe" && c.apiKey === "translator-draft-secret",
			),
		)
		.toBe(true);
	await card.getByRole("button", { name: "Save", exact: true }).click();
	await expect(key).toHaveValue(/^\*+$/);
	expect(
		await page.evaluate(() => JSON.stringify({ ...localStorage })),
	).not.toContain("translator-draft-secret");
	await page.keyboard.press("Escape");
	const add = async () => {
		await page.locator("[data-magic-wand]").click();
		const input = page.getByPlaceholder(
			"arXiv / DOI, paper title, GitHub Skill URL…",
		);
		await input.fill(isbn);
		await input.press("Enter");
	};
	await add();
	await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(1);
	await expect
		.poll(() =>
			calls.some(
				(c) =>
					c.operation === "lookup" &&
					c.query === isbn &&
					c.apiKey === "********",
			),
		)
		.toBe(true);
	await add();
	await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(1);
	await expect
		.poll(async () =>
			(
				await page.request.get(
					`/api/file?path=${encodeURIComponent(`papers/${title}/.paper.json`)}`,
				)
			).status(),
		)
		.toBe(200);
	await page
		.getByRole("toolbar", { name: "Workspace storage", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("button", { name: "General", exact: true }).click();
	await endpoint.fill(previous);
	await key.fill("");
	await card.getByRole("button", { name: "Save", exact: true }).click();
	await expect(key).toHaveValue("");
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					"/api/file?path=.agentero%2Fsettings.json",
				);
				return response.ok()
					? (await response.json()).translator?.baseUrl
					: undefined;
			},
			{ timeout: 30000 },
		)
		.toBe(previous);
});
