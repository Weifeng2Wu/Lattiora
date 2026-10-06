import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("original Skill chooser installs selected resources and keeps them through offline reload", async ({
	page,
	context,
}) => {
	test.setTimeout(240000);
	const name = `web-skill-${Date.now()}`;
	let downloads = 0;
	let mirrorProbes = 0;
	await page.route("**/api/skills/probe", async (route) => {
		expect(route.request().postDataJSON().mirror).toBe("https://ghproxy.net");
		mirrorProbes++;
		await route.fulfill({ json: { ok: true } });
	});
	await page.route("**/api/skills/discover", (route) =>
		route.fulfill({
			json: {
				owner: "owner",
				repo: "repo",
				commit: "a".repeat(40),
				source: "github:owner/repo",
				candidates: [
					{
						name,
						description: "Read documents",
						relativePath: "skill",
						files: ["skill/SKILL.md", "skill/assets/example.bin"],
					},
					{
						name: `${name}-other`,
						description: "Not selected",
						relativePath: "other",
						files: ["other/SKILL.md"],
					},
				],
			},
		}),
	);
	await page.route("**/api/skills/file", async (route) => {
		downloads++;
		expect(route.request().postDataJSON().mirror).toBe("https://ghproxy.net");
		const path = route.request().postDataJSON().path;
		await route.fulfill({
			contentType: "application/octet-stream",
			body: path.endsWith("SKILL.md")
				? `---\nname: ${name}\ndescription: Read documents\n---\nUse workspace tools.`
				: Buffer.from([0, 1, 255]),
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
	const mirrorToggle = page.getByRole("switch", {
		name: "GitHub mirror",
		exact: true,
	});
	await mirrorToggle.setChecked(true);
	await page.locator("#github-mirror-enabled").click();
	await page
		.getByRole("option", { name: "https://ghproxy.net", exact: true })
		.click();
	await page
		.locator("#github-mirror-enabled")
		.locator("..")
		.getByRole("button", { name: "Test connection", exact: true })
		.click();
	await expect.poll(() => mirrorProbes).toBe(1);
	await page.keyboard.press("Escape");
	await page.locator("[data-magic-wand]").click();
	const input = page.getByPlaceholder(
		"arXiv / DOI, paper title, GitHub Skill URL…",
	);
	await input.fill("npx skills add owner/repo");
	await input.press("Enter");
	const dialog = page.getByRole("dialog", { name: "Choose Skills to install" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("checkbox").nth(1).uncheck();
	await dialog.getByRole("button", { name: "Install 1", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	const installed = () =>
		page.evaluate(async (name) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("agentero-cloud-v1", 1);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			const records = await new Promise<
				Array<{ path: string; data: Blob | null; deleted: number }>
			>((resolve) => {
				const req = db.transaction("files").objectStore("files").getAll();
				req.onsuccess = () => resolve(req.result);
			});
			db.close();
			return Promise.all(
				records
					.filter(
						(file) =>
							file.path.startsWith(`.agents/skills/${name}`) && !file.deleted,
					)
					.map(async (file) => ({
						path: file.path,
						bytes: [...new Uint8Array(await file.data!.arrayBuffer())],
					})),
			);
		}, name);
	await expect.poll(async () => (await installed()).length).toBe(3);
	expect(downloads).toBe(2);
	const before = await installed();
	expect(before.find((file) => file.path.endsWith(".bin"))?.bytes).toEqual([
		0, 1, 255,
	]);
	expect(before.some((file) => file.path.includes(`${name}-other`))).toBe(
		false,
	);
	await expect
		.poll(() =>
			page.evaluate(() => navigator.serviceWorker.controller !== null),
		)
		.toBe(true);
	await context.setOffline(true);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible();
	expect(await installed()).toEqual(before);
	await context.setOffline(false);
});

test("user uploads a Skill ZIP offline through the original wand and selects it in the built-in Agent", async ({
	page,
	context,
}) => {
	test.setTimeout(240000);
	const { zipSync } = await import("fflate");
	const name =
		process.env.AGENTERO_SKILL_UPLOAD_NAME ?? `uploaded-skill-${Date.now()}`;
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
	await expect(
		page
			.getByRole("toolbar", { name: "Workspace storage" })
			.getByRole("status"),
	).toContainText("Offline ready", { timeout: 120000 });
	await context.setOffline(true);
	await page.locator("[data-magic-wand]").click();
	const picker = page.waitForEvent("filechooser");
	await page
		.getByRole("button", {
			name: "Upload Skill (SKILL.md or ZIP)",
			exact: true,
		})
		.click();
	await (await picker).setFiles({
		name: "personal-skills.zip",
		mimeType: "application/zip",
		buffer: Buffer.from(
			zipSync({
				"my-skill/SKILL.md": new TextEncoder().encode(
					`---\nname: ${name}\ndescription: User-created research skill\n---\nUse workspace read tools.`,
				),
				"my-skill/references/guide.md": new TextEncoder().encode(
					"Offline reference",
				),
			}),
		),
	});
	const dialog = page.getByRole("dialog", { name: "Choose Skills to install" });
	await expect(dialog.getByText(name, { exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Install 1", exact: true }).click();
	await expect(
		page.getByText("Installed 1 Skills; skipped 0", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	const composer = page.locator("[data-agent-composer-input][contenteditable]");
	if (!(await composer.isVisible()))
		await page
			.getByRole("button", { name: "Show right sidebar", exact: true })
			.click();
	await expect(composer).toBeVisible();
	await composer.fill(`$${name}`);
	await expect(
		page.getByRole("option").filter({ hasText: name }),
	).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => navigator.serviceWorker.controller !== null),
		)
		.toBe(true);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Sync now", exact: true }),
	).toBeVisible();
	await composer.fill(`$${name}`);
	await expect(
		page.getByRole("option").filter({ hasText: name }),
	).toBeVisible();
	await context.setOffline(false);
	await page.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect
		.poll(
			() =>
				page.evaluate(async (name) => {
					const db = await new Promise<IDBDatabase>((resolve, reject) => {
						const req = indexedDB.open("agentero-cloud-v1", 1);
						req.onsuccess = () => resolve(req.result);
						req.onerror = () => reject(req.error);
					});
					const records = await new Promise<
						Array<{ path: string; dirty: boolean; deleted: number }>
					>((resolve) => {
						const req = db.transaction("files").objectStore("files").getAll();
						req.onsuccess = () => resolve(req.result);
					});
					db.close();
					const installed = records.filter(
						(file) =>
							file.path.startsWith(`.agents/skills/${name}/`) && !file.deleted,
					);
					return (
						installed.length === 3 && installed.every((file) => !file.dirty)
					);
				}, name),
			{ timeout: 60000 },
		)
		.toBe(true);
});
