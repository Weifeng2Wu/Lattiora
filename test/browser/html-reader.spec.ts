import { expect, test } from "@playwright/test";
import { finishInitialSetup } from "./setup";

test("original HTML reader isolates website scripts, navigates and keeps selection controls offline", async ({
	page,
	context,
}) => {
	test.skip(Boolean(process.env.CLOUD_E2E_URL), "Local public HTML fixture");
	test.setTimeout(180000);
	const title = `html-${Date.now()}`,
		url = `https://reader.example/${title}`;
	let reads = 0;
	await page.route("**/api/feeds/fetch", async (route) => {
		const input = route.request().postDataJSON();
		if (!input.url.startsWith(url)) {
			await route.continue();
			return;
		}
		reads++;
		const second = input.url.endsWith("/next");
		await route.fulfill({
			json: {
				url: input.url,
				status: 200,
				contentType: "text/html",
				body: `<!doctype html><html><head><style>h1 {color: rgb(12, 34, 56)}</style><meta http-equiv="refresh" content="0; url=https://attacker.example"></head><body><h1>${second ? "Second page" : "Original HTML paper"}</h1><p id="quote">Scientific text with a useful selection for the original toolbar.</p><a href="${url}/next">Next page</a><script>parent.postMessage({pwned:true},'*');fetch('/api/settings');</script><img src="x" onerror="parent.postMessage({pwned:true},'*')"></body></html>`,
			},
		});
	});
	await page.addInitScript(() => {
		(window as unknown as { pwned: boolean }).pwned = false;
		window.addEventListener("message", (event) => {
			if (event.data?.pwned)
				(window as unknown as { pwned: boolean }).pwned = true;
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
	await expect(
		page.getByRole("status").filter({ hasText: "Offline ready" }).first(),
	).toBeVisible({ timeout: 120000 });
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const chooser = page.waitForEvent("filechooser");
	await page
		.getByRole("menuitem", { name: "Import BibTeX / RIS / JSON", exact: true })
		.click();
	await (await chooser).setFiles({
		name: "html.json",
		mimeType: "application/json",
		buffer: Buffer.from(
			JSON.stringify([{ title, type: "html", html_url: url }]),
		),
	});
	await page.getByRole("row").filter({ hasText: title }).click();
	const frame = page.frameLocator('iframe[title="HTML paper sandbox"]');
	await expect(
		frame.getByRole("heading", { name: "Original HTML paper" }),
	).toBeVisible({ timeout: 45000 });
	await expect(frame.locator("h1")).toHaveCSS("color", "rgb(12, 34, 56)");
	expect(
		await page.evaluate(() => (window as unknown as { pwned: boolean }).pwned),
	).toBe(false);
	const isolated = await frame.locator("body").evaluate(() => {
		try {
			void parent.document;
			return false;
		} catch {
			return true;
		}
	});
	expect(isolated).toBe(true);
	await frame.locator("#quote").evaluate((node) => {
		const range = document.createRange();
		range.selectNodeContents(node);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	});
	await expect(
		page.getByRole("button", { name: /Ask.*Ctrl|Ask.*⌘|Quick chat/i }).first(),
	).toBeVisible();
	await frame.getByRole("link", { name: "Next page" }).click();
	await expect(
		frame.getByRole("heading", { name: "Second page" }),
	).toBeVisible();
	const before = reads;
	await context.setOffline(true);
	await page.reload();
	// Tab restores the paper's original URL; its cached first page is still readable.
	await expect(
		frame.getByRole("heading", { name: "Original HTML paper" }),
	).toBeVisible({ timeout: 45000 });
	expect(reads).toBe(before);
});
