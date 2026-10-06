import { crc32, deflateSync } from "node:zlib";
import type { ImageDataLike } from "@embedpdf/models";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

/** Dependency-free PNG output for the opt-in, browser-free layout smoke test. */
export function layoutPng(
	image: ImageDataLike,
	regions: PdfLayoutRegion[] = [],
): Buffer {
	const { width, height } = image;
	const pixels = Buffer.from(image.data);
	for (const region of regions) {
		const b = region.bbox;
		const x1 = Math.max(0, Math.floor(b.x * width)),
			y1 = Math.max(0, Math.floor(b.y * height));
		const x2 = Math.min(width - 1, Math.ceil((b.x + b.w) * width)),
			y2 = Math.min(height - 1, Math.ceil((b.y + b.h) * height));
		for (let y = y1; y <= y2; y++)
			for (let x = x1; x <= x2; x++) {
				if (x - x1 >= 3 && x2 - x >= 3 && y - y1 >= 3 && y2 - y >= 3) continue;
				const i = (y * width + x) * 4;
				pixels[i] = 230;
				pixels[i + 1] = 30;
				pixels[i + 2] = 40;
				pixels[i + 3] = 255;
			}
	}
	const scanlines = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++)
		pixels.copy(
			scanlines,
			y * (width * 4 + 1) + 1,
			y * width * 4,
			(y + 1) * width * 4,
		);
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type), data]);
		const head = Buffer.alloc(4);
		head.writeUInt32BE(data.length);
		const tail = Buffer.alloc(4);
		tail.writeUInt32BE(crc32(body));
		return Buffer.concat([head, body, tail]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(scanlines)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
