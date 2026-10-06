export class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

/** Enforce the actual streamed size, including requests without Content-Length. */
export async function readBytes(
	request: Pick<Request, "headers" | "body">,
	limit: number,
): Promise<Uint8Array> {
	if (Number(request.headers.get("content-length")) > limit)
		throw new HttpError(413, "tooLarge");
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const parts: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new HttpError(413, "tooLarge");
			}
			parts.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

export async function readJson(
	request: Request,
	limit = 1024 * 1024,
): Promise<unknown> {
	if (!request.headers.get("content-type")?.startsWith("application/json"))
		throw new HttpError(415, "jsonRequired");
	try {
		return JSON.parse(
			new TextDecoder().decode(await readBytes(request, limit)),
		);
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(400, "invalidJson");
	}
}

export function json(
	value: unknown,
	status = 200,
	headers?: HeadersInit,
): Response {
	return Response.json(value, { status, headers });
}
