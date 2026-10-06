import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "test/browser",
	outputDir: process.env.CLOUD_E2E_URL
		? "test-results/live"
		: "test-results/local",
	timeout: 120_000,
	expect: { timeout: 20_000 },
	workers: 1,
	use: {
		baseURL:
			process.env.AGENTERO_TEST_URL ??
			process.env.CLOUD_E2E_URL ??
			"http://127.0.0.1:8790",
		viewport: { width: 1440, height: 960 },
		launchOptions: {
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
			args: ["--no-sandbox"],
		},
		// Login bodies and cookies must not be captured in traces.
		trace: "off",
		screenshot: "only-on-failure",
	},
});
