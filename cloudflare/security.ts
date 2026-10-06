import type { AiConfig } from "../src/lib/cloud/protocol";

const encoder = new TextEncoder();
function hex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
async function hmac(secret: string, value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export async function sameSecret(a: string, b: string): Promise<boolean> {
	const [x, y] = await Promise.all([
		hmac("agentero-compare", a),
		hmac("agentero-compare", b),
	]);
	let difference = 0;
	for (let i = 0; i < x.length; i++)
		difference |= x.charCodeAt(i) ^ y.charCodeAt(i);
	return difference === 0;
}
export async function session(secret: string): Promise<string> {
	const expires = String(Date.now() + 30 * 86400_000);
	return `${expires}.${await hmac(secret, expires)}`;
}
export async function authenticated(
	request: Request,
	secret: string,
): Promise<boolean> {
	const value = /(?:^|;\s*)agentero_session=([^;]+)/.exec(
		request.headers.get("cookie") ?? "",
	)?.[1];
	if (!value) return false;
	const parts = /^(\d{13})\.([\da-f]{64})$/.exec(value);
	if (!parts) return false;
	const [, expires, signature] = parts;
	if (Number(expires) <= Date.now()) return false;
	return sameSecret(signature, await hmac(secret, expires));
}
async function encryptionKey(secret: string): Promise<CryptoKey> {
	if (!/^[\da-f]{64}$/i.test(secret)) throw new Error("invalidEncryptionKey");
	const bytes = new Uint8Array(
		secret.match(/../g)!.map((v) => Number.parseInt(v, 16)),
	);
	return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}
export async function encrypt(
	config: unknown,
	secret: string,
	purpose = "agentero-ai-v1",
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) },
		await encryptionKey(secret),
		encoder.encode(JSON.stringify(config)),
	);
	return JSON.stringify({
		iv: [...iv],
		ciphertext: [...new Uint8Array(ciphertext)],
	});
}
export async function decrypt<T = AiConfig>(
	value: string,
	secret: string,
	purpose = "agentero-ai-v1",
): Promise<T> {
	const { iv, ciphertext } = JSON.parse(value);
	const plaintext = await crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: new Uint8Array(iv),
			additionalData: encoder.encode(purpose),
		},
		await encryptionKey(secret),
		new Uint8Array(ciphertext),
	);
	return JSON.parse(new TextDecoder().decode(plaintext));
}
