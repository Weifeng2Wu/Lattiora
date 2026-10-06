#!/usr/bin/env node
/**
 * Probe Zotero-compatible Translator Runtime availability.
 *
 * Mirrors Host paths in `src-tauri/src/services/lookup/`:
 *   POST /search  — identifier (arXiv id, DOI, …)  Content-Type: text/plain
 *   POST /web     — page URL                       Content-Type: text/plain
 *   POST /import  — BibTeX / RIS → Zotero JSON
 *   POST /export  — Zotero JSON → BibTeX / …
 *
 * Default base matches `DEFAULT_TRANSLATOR_BASE_URL` /
 * `src-tauri/.../lookup/mod.rs`.
 *
 * Usage:
 *   node test/scripts/probe-translator.mjs
 *   node test/scripts/probe-translator.mjs --base http://127.0.0.1:1969
 *   node test/scripts/probe-translator.mjs --only search,web
 *   node test/scripts/probe-translator.mjs --json
 *   node test/scripts/probe-translator.mjs --timeout 20000
 *
 * Env:
 *   TRANSLATOR_BASE_URL  override base (same as --base)
 *
 * Exit codes:
 *   0  all critical checks passed (search + web)
 *   1  one or more critical checks failed
 *   2  usage / config error
 *
 * Not imported by the app. Safe for CI with a live base, or local sidecar.
 */

const DEFAULT_BASE = "https://translation-server.agentero.app";
/** Same class of UA as Host `translator_fetch`. */
const APP_UA =
	"agentero-lookup/0.1 (+https://github.com/poco-ai/agentero; probe)";

const args = process.argv.slice(2);

function flag(name, fallback) {
	const i = args.indexOf(name);
	if (i >= 0 && args[i + 1] != null && !String(args[i + 1]).startsWith("--")) {
		return args[i + 1];
	}
	return fallback;
}

function hasFlag(name) {
	return args.includes(name);
}

if (hasFlag("--help") || hasFlag("-h")) {
	console.log(`Usage: node test/scripts/probe-translator.mjs [options]

Options:
  --base <url>       Translator base (default: ${DEFAULT_BASE})
  --only <ids>       Comma list: search,search-doi,web,import,export,dns
  --timeout <ms>     Per-request timeout (default: 30000)
  --json             Machine-readable summary on stdout
  --quiet            Only print summary table
  -h, --help         This help

Env: TRANSLATOR_BASE_URL
`);
	process.exit(0);
}

const BASE = (
	flag("--base", process.env.TRANSLATOR_BASE_URL || DEFAULT_BASE) ||
	DEFAULT_BASE
)
	.trim()
	.replace(/\/+$/, "");
const TIMEOUT_MS = Number(flag("--timeout", "30000")) || 30000;
const JSON_OUT = hasFlag("--json");
const QUIET = hasFlag("--quiet");
const ONLY = flag("--only", "")
	.split(",")
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

const ARXIV_ID = "1706.03762";
const ARXIV_URL = `https://arxiv.org/abs/${ARXIV_ID}`;
const DOI = "10.1038/nature14539";
const BIBTEX = `@article{probe2024,
  title = {Translator Probe Paper},
  author = {Doe, Jane},
  year = {2024},
  journal = {Probe Journal}
}`;
const EXPORT_ITEM = [
	{
		itemType: "journalArticle",
		title: "Translator Probe Export",
		creators: [{ creatorType: "author", firstName: "Jane", lastName: "Doe" }],
		date: "2024",
	},
];

/** @typedef {"ok"|"fail"|"skip"} Status */

/**
 * @typedef {object} CaseResult
 * @property {string} id
 * @property {string} label
 * @property {boolean} critical
 * @property {Status} status
 * @property {number|null} http
 * @property {number} ms
 * @property {string} detail
 */

/** @type {CaseResult[]} */
const results = [];

function want(id) {
	return ONLY.length === 0 || ONLY.includes(id);
}

function log(...parts) {
	if (!QUIET && !JSON_OUT) console.log(...parts);
}

async function fetchWithTimeout(url, init = {}) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		return await fetch(url, {
			...init,
			signal: ctrl.signal,
			headers: {
				"User-Agent": APP_UA,
				Accept: "*/*",
				...(init.headers || {}),
			},
		});
	} finally {
		clearTimeout(t);
	}
}

function isCloudflareChallenge(text) {
	const t = text.toLowerCase();
	return (
		t.includes("just a moment") ||
		t.includes("cf-browser-verification") ||
		t.includes("challenge-platform") ||
		t.includes("attention required") ||
		t.includes("checking your browser")
	);
}

function isCloudflare502Json(text) {
	try {
		const v = JSON.parse(text);
		return (
			v?.status === 502 ||
			String(v?.title || "")
				.toLowerCase()
				.includes("bad gateway")
		);
	} catch {
		return false;
	}
}

function snippet(s, n = 120) {
	const t = String(s ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.label
 * @param {boolean} [opts.critical]
 * @param {() => Promise<string>} opts.run  returns short success detail
 */
async function runCase({ id, label, critical = false, run }) {
	if (!want(id)) {
		results.push({
			id,
			label,
			critical,
			status: "skip",
			http: null,
			ms: 0,
			detail: "skipped (--only)",
		});
		return;
	}

	const t0 = performance.now();
	log(`\n=== ${label} (${id}) ===`);
	try {
		const out = await run();
		const ms = Math.round(performance.now() - t0);
		const detail = typeof out === "string" ? out : out.detail;
		const http =
			typeof out === "object" && out && "http" in out ? out.http : null;
		results.push({
			id,
			label,
			critical,
			status: "ok",
			http,
			ms,
			detail,
		});
		log(`✅ ${ms}ms  ${detail}`);
	} catch (e) {
		const ms = Math.round(performance.now() - t0);
		const err = e instanceof Error ? e : new Error(String(e));
		const http =
			typeof (/** @type {{ http?: number }} */ (err).http) === "number"
				? /** @type {{ http?: number }} */ (err).http
				: /\bHTTP (\d+)\b/.test(err.message)
					? Number(err.message.match(/\bHTTP (\d+)\b/)?.[1])
					: null;
		const detail = snippet(err.message, 200);
		results.push({
			id,
			label,
			critical,
			status: "fail",
			http: http ?? null,
			ms,
			detail,
		});
		log(`❌ ${ms}ms  ${detail}`);
	}
}

/**
 * @param {string} path
 * @param {string|Uint8Array} body
 * @param {string} contentType
 * @param {(res: Response, text: string) => string} assertOk
 */
async function postEndpoint(path, body, contentType, assertOk) {
	const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
	log(`→ POST ${url}`);
	let res;
	try {
		res = await fetchWithTimeout(url, {
			method: "POST",
			headers: { "Content-Type": contentType },
			body,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("abort") || msg.includes("Timeout")) {
			throw Object.assign(new Error(`timeout after ${TIMEOUT_MS}ms`), {
				http: null,
			});
		}
		throw Object.assign(new Error(`network: ${msg}`), { http: null });
	}

	const text = await res.text();
	const httpErr = (message) =>
		Object.assign(new Error(message), { http: res.status });

	if (isCloudflareChallenge(text)) {
		throw httpErr(
			`HTTP ${res.status}: Cloudflare bot challenge (Just a moment…)`,
		);
	}
	if (res.status === 502 || isCloudflare502Json(text)) {
		throw httpErr(
			`HTTP ${res.status}: Bad Gateway — origin down or invalid response behind Cloudflare`,
		);
	}
	if (!res.ok) {
		throw httpErr(`HTTP ${res.status}: ${snippet(text, 160)}`);
	}
	const detail = assertOk(res, text);
	return { detail, http: res.status };
}

function parseJsonArray(text) {
	let v;
	try {
		v = JSON.parse(text);
	} catch (_e) {
		throw new Error(`invalid JSON: ${snippet(text, 100)}`);
	}
	if (!Array.isArray(v)) {
		throw new Error(`expected JSON array, got ${typeof v}`);
	}
	return v;
}

function firstItem(arr) {
	let it = arr[0];
	if (Array.isArray(it) && it.length) it = it[0];
	return it && typeof it === "object" ? it : null;
}

async function caseDns() {
	const host = new URL(BASE).hostname;
	const { lookup } = await import("node:dns/promises");
	const r = await lookup(host, { all: true });
	const addrs = r.map((x) => x.address).join(", ");
	if (!addrs) throw new Error("no addresses");
	return { detail: `DNS ${host} → ${addrs}`, http: null };
}

async function caseSearchArxiv() {
	return postEndpoint("/search", ARXIV_ID, "text/plain", (_res, text) => {
		const arr = parseJsonArray(text);
		if (!arr.length) throw new Error("empty array");
		const it = firstItem(arr);
		const title = it?.title ? String(it.title) : "";
		if (!title) throw new Error("missing title on first item");
		// Soft check — don't fail if title differs (redirect / mirror)
		const hint =
			/attention is all you need/i.test(title) || /transformer/i.test(title)
				? "expected paper"
				: "title present";
		return `JSON[${arr.length}] itemType=${it?.itemType ?? "?"} title="${snippet(title, 60)}" (${hint})`;
	});
}

async function caseSearchDoi() {
	return postEndpoint("/search", DOI, "text/plain", (_res, text) => {
		const arr = parseJsonArray(text);
		if (!arr.length) throw new Error("empty array");
		const it = firstItem(arr);
		const title = it?.title ? String(it.title) : "";
		if (!title) throw new Error("missing title");
		return `JSON[${arr.length}] itemType=${it?.itemType ?? "?"} title="${snippet(title, 60)}"`;
	});
}

async function caseWeb() {
	return postEndpoint("/web", ARXIV_URL, "text/plain", (_res, text) => {
		const arr = parseJsonArray(text);
		if (!arr.length) throw new Error("empty array");
		const it = firstItem(arr);
		const title = it?.title ? String(it.title) : "";
		if (!title) throw new Error("missing title");
		return `JSON[${arr.length}] itemType=${it?.itemType ?? "?"} title="${snippet(title, 60)}"`;
	});
}

async function caseImport() {
	return postEndpoint("/import", BIBTEX, "text/plain", (_res, text) => {
		const arr = parseJsonArray(text);
		if (!arr.length) throw new Error("empty array");
		const it = firstItem(arr);
		const title = it?.title ? String(it.title) : "";
		return `JSON[${arr.length}] title="${snippet(title || "(no title)", 60)}"`;
	});
}

async function caseExport() {
	return postEndpoint(
		"/export?format=bibtex",
		JSON.stringify(EXPORT_ITEM),
		"application/json",
		(_res, text) => {
			const t = text.trim();
			if (!t) throw new Error("empty body");
			if (t.startsWith("{") || t.startsWith("[")) {
				// Some servers wrap export errors as JSON
				throw new Error(`expected BibTeX text, got JSON: ${snippet(t, 80)}`);
			}
			if (!t.includes("@") && !/title\s*=/i.test(t)) {
				throw new Error(`unexpected export body: ${snippet(t, 80)}`);
			}
			return `BibTeX ${t.length} chars: ${snippet(t, 70)}`;
		},
	);
}

async function main() {
	if (!BASE.startsWith("http://") && !BASE.startsWith("https://")) {
		console.error(`Invalid base URL: ${BASE}`);
		process.exit(2);
	}

	if (!JSON_OUT) {
		console.log("### Translator probe");
		console.log(`Base: ${BASE}`);
		console.log(`Timeout: ${TIMEOUT_MS}ms`);
		console.log(`UA: ${APP_UA}`);
		console.log(`Time: ${new Date().toISOString()}`);
	}

	await runCase({
		id: "dns",
		label: "DNS resolve",
		critical: false,
		run: caseDns,
	});
	await runCase({
		id: "search",
		label: "POST /search (arXiv id)",
		critical: true,
		run: caseSearchArxiv,
	});
	await runCase({
		id: "search-doi",
		label: "POST /search (DOI)",
		critical: false,
		run: caseSearchDoi,
	});
	await runCase({
		id: "web",
		label: "POST /web (arXiv URL)",
		critical: true,
		run: caseWeb,
	});
	await runCase({
		id: "import",
		label: "POST /import (BibTeX)",
		critical: false,
		run: caseImport,
	});
	await runCase({
		id: "export",
		label: "POST /export?format=bibtex",
		critical: false,
		run: caseExport,
	});

	const critical = results.filter((r) => r.critical && r.status !== "skip");
	const criticalOk = critical.every((r) => r.status === "ok");
	const okCount = results.filter((r) => r.status === "ok").length;
	const failCount = results.filter((r) => r.status === "fail").length;
	const skipCount = results.filter((r) => r.status === "skip").length;

	const summary = {
		base: BASE,
		ok: criticalOk,
		counts: { ok: okCount, fail: failCount, skip: skipCount },
		results: results.map(
			({ id, label, critical, status, http, ms, detail }) => ({
				id,
				label,
				critical,
				status,
				http,
				ms,
				detail,
			}),
		),
	};

	if (JSON_OUT) {
		console.log(JSON.stringify(summary, null, 2));
	} else {
		console.log("\n========== SUMMARY ==========");
		const pad = (s, n) => String(s).padEnd(n);
		for (const r of results) {
			const icon = r.status === "ok" ? "✅" : r.status === "skip" ? "⏭️" : "❌";
			const crit = r.critical ? "*" : " ";
			console.log(
				`${icon}${crit} ${pad(r.id, 12)} ${pad(r.status, 4)} ${pad(`${r.ms}ms`, 8)} ${r.http != null ? `HTTP ${r.http}` : "        "}  ${snippet(r.detail, 90)}`,
			);
		}
		console.log(
			`\nCritical (search + web): ${criticalOk ? "✅ PASS" : "❌ FAIL"}  |  ok=${okCount} fail=${failCount} skip=${skipCount}`,
		);
		if (!criticalOk) {
			console.log(
				"\nHints:\n" +
					"  • HTTP 502 + Cloudflare → origin translation-server is down\n" +
					"  • Cloudflare challenge → bot protection; try local sidecar or allowlist API\n" +
					"  • Local sidecar: docker/node translation-server on :1969, then --base http://127.0.0.1:1969\n" +
					"  • Host falls back to arXiv Atom only for arXiv ids when /search fails",
			);
		}
	}

	process.exit(criticalOk ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(2);
});
