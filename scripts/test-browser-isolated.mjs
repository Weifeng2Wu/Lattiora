import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Each spec gets its own D1/R2 state. Browser contexts alone do not isolate
// synced settings, papers, service credentials or the semantic index's sources.
if (process.env.CLOUD_E2E_URL || process.env.AGENTERO_TEST_URL) {
	throw new Error("Isolated browser tests must start their own local Worker.");
}
const root = process.cwd();
const available = (await readdir("test/browser"))
	.filter((file) => file.endsWith(".spec.ts"))
	.sort()
	.map((file) => `test/browser/${file}`);
const specs = process.argv.length > 2 ? process.argv.slice(2) : available;
if (specs.some((spec) => !available.includes(spec))) {
	throw new Error("Pass test/browser/*.spec.ts paths from this repository.");
}
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
config.main = resolve(config.main);
config.assets.directory = resolve(config.assets.directory);
for (const database of config.d1_databases) {
	database.migrations_dir = resolve(database.migrations_dir);
}
const children = new Set();
const stop = (child) => {
	if (child.exitCode === null && child.signalCode === null) {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	}
};
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, () => {
		for (const child of children) stop(child);
		process.exit(signal === "SIGINT" ? 130 : 143);
	});
}
function run(args, options = {}) {
	const child = spawn("pnpm", ["exec", ...args], {
		cwd: root,
		env: process.env,
		stdio: "inherit",
		detached: true,
		...options,
	});
	children.add(child);
	const done = new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => {
			children.delete(child);
			resolve(code);
		});
	});
	return { child, done };
}
async function freePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address();
	await new Promise((resolve) => server.close(resolve));
	return port;
}
const failed = [];
for (const spec of specs) {
	const scratch = await mkdtemp(join(tmpdir(), "lattiora-browser-"));
	const output = resolve("test-results/isolated", basename(spec, ".spec.ts"));
	await mkdir(output, { recursive: true });
	const log = createWriteStream(join(output, "worker.log"));
	let worker;
	try {
		const configPath = join(scratch, "wrangler.json");
		await writeFile(configPath, JSON.stringify(config));
		await writeFile(
			join(scratch, ".dev.vars"),
			'ACCESS_PASSWORD="local-development-password-32-chars"\nENCRYPTION_KEY="abababababababababababababababababababababababababababababababab"\n',
		);
		const state = [
			"--config",
			configPath,
			"--persist-to",
			join(scratch, "state"),
		];
		console.log(`\nIsolated browser suite: ${spec}`);
		const migration = run(
			["wrangler", "d1", "migrations", "apply", "DB", "--local", ...state],
			{ stdio: ["ignore", log, log] },
		);
		if ((await migration.done) !== 0) throw new Error("Local migration failed");
		const port = await freePort();
		const url = `http://127.0.0.1:${port}`;
		worker = run(
			[
				"wrangler",
				"dev",
				...state,
				"--port",
				String(port),
				"--inspector-port",
				"0",
			],
			{ stdio: ["ignore", log, log] },
		);
		const deadline = Date.now() + 60000;
		for (;;) {
			if (worker.child.exitCode !== null)
				throw new Error("Local Worker exited");
			try {
				if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) break;
			} catch {
				/* Wait for the local listener, never a remote deployment. */
			}
			if (Date.now() >= deadline)
				throw new Error("Local Worker did not become ready");
			await delay(500);
		}
		const tests = run(
			["playwright", "test", spec, "--output", join(output, "browser")],
			{
				env: {
					...process.env,
					AGENTERO_TEST_URL: url,
					AGENTERO_TEST_PASSWORD: "local-development-password-32-chars",
				},
			},
		);
		if ((await tests.done) !== 0) failed.push(spec);
	} catch (error) {
		console.error(`${spec}: ${error.message}; see ${output}/worker.log`);
		failed.push(spec);
	} finally {
		if (worker) {
			stop(worker.child);
			await worker.done;
		}
		log.end();
		await rm(scratch, { recursive: true, force: true });
	}
}
console.log(
	`\nBrowser suites: ${specs.length - failed.length} passed, ${failed.length} failed.`,
);
if (failed.length) {
	console.error(failed.join("\n"));
	process.exitCode = 1;
}
