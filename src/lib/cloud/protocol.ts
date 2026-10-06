/** Shared browser / Worker wire contract. No runtime-specific imports. */
export const MAX_TEXT_BYTES = 512 * 1024;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const CLOUD_ROOT = "/cloud";

export type FileMeta = {
	path: string;
	version: number;
	seq: number;
	mutation_id: string;
	deleted: number;
	mime: string;
	size: number;
	updated_at: number;
};
export type FileWrite = {
	path: string;
	version: number;
	mutation_id: string;
	deleted: boolean;
	content: string | null;
	blob_key: string | null;
	mime: string;
};
export type AiConfig = {
	provider: "openai" | "anthropic";
	baseUrl: string;
	model: string;
	apiKey: string;
};
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatEvent =
	| { type: "delta"; text: string }
	| { type: "done"; reason: string }
	| { type: "error"; error: string };

export function validPath(path: unknown): path is string {
	return (
		typeof path === "string" &&
		path.length > 0 &&
		path.length <= 1024 &&
		!path.startsWith("/") &&
		!path.includes("\\") &&
		[...path].every((char) => char.charCodeAt(0) >= 32) &&
		path.split("/").every((p) => p !== ".." && p !== "." && p.length > 0)
	);
}

export function providerEndpoint(
	base: string,
	provider: AiConfig["provider"],
): string {
	const url = new URL(base);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!url.hostname.includes(".") ||
		/^[\d.]+$/.test(url.hostname) ||
		url.hostname.includes(":") ||
		/\.(localhost|local|internal)$/.test(url.hostname)
	) {
		throw new Error("invalidEndpoint");
	}
	const suffix = provider === "anthropic" ? "/messages" : "/chat/completions";
	url.pathname = url.pathname.replace(/\/+$/, "");
	if (!url.pathname || url.pathname === "/") url.pathname = "/v1";
	if (!url.pathname.endsWith(suffix)) url.pathname += suffix;
	return url.toString();
}
