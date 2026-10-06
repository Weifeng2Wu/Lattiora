/**
 * Application logger (see `docs/development/logging.md`).
 *
 * Tauri: `@tauri-apps/plugin-log` → Host stdout + LogDir (+ Webview in dev).
 * Plain browser / tests: `console.*` fallback.
 */

import { errorText } from "@/lib/core/error";

type Level = "trace" | "debug" | "info" | "warn" | "error";

function serializeFields(fields?: Record<string, unknown>): string {
	if (!fields) return "";
	const parts: string[] = [];
	for (const [k, v] of Object.entries(fields)) {
		if (v === undefined || v === null) continue;
		let s: string;
		if (typeof v === "string") s = trunc(v, 200);
		else if (typeof v === "number" || typeof v === "boolean") s = String(v);
		else s = trunc(JSON.stringify(v), 200);
		if (!s) continue;
		// Avoid spaces breaking field scan; keep simple key=value.
		parts.push(`${k}=${s.replace(/\s+/g, " ")}`);
	}
	return parts.length ? ` ${parts.join(" ")}` : "";
}

function trunc(s: string, max: number): string {
	const t = s.trim();
	if (t.length <= max) return t;
	return `${t.slice(0, Math.max(0, max - 1))}…`;
}

async function write(level: Level, message: string): Promise<void> {
	const text = message?.trim();
	if (!text) return;

	{
		const c = console as Console & Record<string, (...a: unknown[]) => void>;
		const fn = c[level] ?? console.log;
		fn.call(console, text);
		return;
	}
}

export const logger = {
	trace: (msg: string, fields?: Record<string, unknown>) => {
		void write("trace", `${msg}${serializeFields(fields)}`);
	},
	debug: (msg: string, fields?: Record<string, unknown>) => {
		void write("debug", `${msg}${serializeFields(fields)}`);
	},
	info: (msg: string, fields?: Record<string, unknown>) => {
		void write("info", `${msg}${serializeFields(fields)}`);
	},
	warn: (msg: string, fields?: Record<string, unknown>) => {
		void write("warn", `${msg}${serializeFields(fields)}`);
	},
	error: (msg: string, fields?: Record<string, unknown>) => {
		void write("error", `${msg}${serializeFields(fields)}`);
	},
};

/** Delete / truncate Host log files under the app log directory. */
export async function clearLogs(): Promise<number> {
	return 0;
}

/** Dev: mirror Host logs into the webview console. No-op outside Tauri. */
export async function initLogger(): Promise<void> {
	return;
}

/**
 * Timed key operation: always emits `op start` / `op end` with duration_ms.
 * Re-throws on failure after logging `ok=false`.
 */
export async function logOp<T>(
	name: string,
	fields: Record<string, unknown> | undefined,
	fn: () => Promise<T>,
): Promise<T> {
	const fieldStr = serializeFields(fields);
	const start = performance.now();
	logger.info(`op start ${name}${fieldStr}`);
	try {
		const result = await fn();
		const ms = Math.round(performance.now() - start);
		logger.info(`op end ${name} ok=true duration_ms=${ms}${fieldStr}`);
		return result;
	} catch (e) {
		const ms = Math.round(performance.now() - start);
		const err = errorText(e);
		logger.error(
			`op end ${name} ok=false duration_ms=${ms}${fieldStr} error=${trunc(err, 300)}`,
		);
		throw e;
	}
}
