export type PlazaGrant = {
	site: "coolpapers" | "modelscope";
	parent: string;
	proxy: string;
	expires: number;
	labels: { import: string; pending: string; done: string };
};
const encode = (data: Uint8Array) =>
	btoa(String.fromCharCode(...data))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
const decode = (data: string) =>
	Uint8Array.from(atob(data.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
		c.charCodeAt(0),
	);
async function key(secret: string) {
	if (!/^[a-f\d]{64}$/i.test(secret)) throw new Error("setupRequired");
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(`agentero-plaza-v1:${secret}`),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}
export async function signPlazaGrant(
	grant: PlazaGrant,
	secret: string,
): Promise<string> {
	const body = encode(new TextEncoder().encode(JSON.stringify(grant)));
	const signature = await crypto.subtle.sign(
		"HMAC",
		await key(secret),
		new TextEncoder().encode(body),
	);
	return `${body}.${encode(new Uint8Array(signature))}`;
}
export async function verifyPlazaGrant(
	token: string,
	secret: string,
): Promise<PlazaGrant | null> {
	try {
		if (token.length > 4096) return null;
		const [body, signature, extra] = token.split(".");
		if (
			!body ||
			!signature ||
			extra ||
			!(await crypto.subtle.verify(
				"HMAC",
				await key(secret),
				decode(signature),
				new TextEncoder().encode(body),
			))
		)
			return null;
		const grant = JSON.parse(
			new TextDecoder().decode(decode(body)),
		) as PlazaGrant;
		if (
			!["coolpapers", "modelscope"].includes(grant.site) ||
			!Number.isSafeInteger(grant.expires) ||
			grant.expires <= Date.now() ||
			grant.expires > Date.now() + 86_400_000 ||
			!grant.labels ||
			[grant.labels.import, grant.labels.pending, grant.labels.done].some(
				(value) => typeof value !== "string" || value.length > 80,
			)
		)
			return null;
		if (
			new URL(grant.parent).origin !== grant.parent ||
			new URL(grant.proxy).origin !== grant.proxy
		)
			return null;
		return grant;
	} catch {
		return null;
	}
}
