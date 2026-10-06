/** Load the local Cloudflare token without sourcing shell code or echoing it. */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

function readEnv(path) {
	try {
		return Object.fromEntries(
			readFileSync(path, "utf8")
				.split(/\r?\n/)
				.flatMap((line) => {
					const match = /^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/.exec(line);
					if (!match) return [];
					let value = match[2];
					if (
						(value.startsWith('"') && value.endsWith('"')) ||
						(value.startsWith("'") && value.endsWith("'"))
					)
						value = value.slice(1, -1);
					return [[match[1], value]];
				}),
		);
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw error;
	}
}
const local = readEnv(".env.cf");
const token =
	process.env.CLOUDFLARE_API_TOKEN ||
	local.CLOUDFLARE_API_TOKEN ||
	local.CF_API;
if (!token)
	throw new Error(
		"Set CLOUDFLARE_API_TOKEN, or CF_API in the ignored .env.cf file.",
	);
const env = { ...process.env, CLOUDFLARE_API_TOKEN: token };
if (!env.CLOUDFLARE_ACCOUNT_ID) {
	const response = await fetch(
		"https://api.cloudflare.com/client/v4/accounts",
		{ headers: { authorization: `Bearer ${token}` } },
	);
	const result = await response.json();
	if (!result.success || result.result?.length !== 1)
		throw new Error("Set CLOUDFLARE_ACCOUNT_ID explicitly for this token.");
	env.CLOUDFLARE_ACCOUNT_ID = result.result[0].id;
}
const args = process.argv.slice(2);
if (!args.length)
	throw new Error("Usage: node scripts/cloudflare.mjs <wrangler arguments>");
const child = spawn("pnpm", ["exec", "wrangler", ...args], {
	env,
	stdio: "inherit",
});
child.on("exit", (code) => {
	process.exitCode = code ?? 1;
});
