import { gzipSync } from "fflate";
import { expect, it } from "vitest";
import {
	parseSourceTar,
	unpackArxivSource,
} from "../src/lib/cloud/source-archive";

function tar(path: string, content: string, kind = "0") {
	const body = new TextEncoder().encode(content),
		header = new Uint8Array(512);
	const put = (start: number, value: string) =>
		header.set(new TextEncoder().encode(value), start);
	put(0, path);
	put(124, body.length.toString(8).padStart(11, "0") + "\0");
	put(148, "        ");
	put(156, kind);
	put(257, "ustar");
	const sum = header.reduce((a, b) => a + b, 0);
	put(148, sum.toString(8).padStart(6, "0") + "\0 ");
	const bytes = new Uint8Array(512 + Math.ceil(body.length / 512) * 512 + 1024);
	bytes.set(header);
	bytes.set(body, 512);
	return bytes;
}
it("extracts gzip tar and arXiv single TeX source with their original bytes", async () => {
	const source =
		"\\documentclass{article}\n\\begin{document}研究\\end{document}";
	const result = await unpackArxivSource(
		new Blob([gzipSync(tar("main.tex", source))]),
	);
	expect(result[0].path).toBe("main.tex");
	expect(new TextDecoder().decode(result[0].data)).toBe(source);
	expect(
		(
			await unpackArxivSource(
				new Blob([gzipSync(new TextEncoder().encode(source))]),
			)
		)[0].path,
	).toBe("main.tex");
});
it("rejects traversal, links, malformed checksums and non-source publisher responses", async () => {
	expect(() => parseSourceTar(tar("../NOTES.md", "overwrite"))).toThrow(
		"invalidSourceArchive",
	);
	expect(() => parseSourceTar(tar("link", "", "2"))).toThrow(
		"unsupportedSourceArchive",
	);
	const damaged = tar("main.tex", "test");
	damaged[0] ^= 1;
	expect(() => parseSourceTar(damaged)).toThrow("invalidSourceArchive");
	await expect(
		unpackArxivSource(new Blob(["<html>rate limited</html>"])),
	).rejects.toThrow("sourceUnavailable");
	await expect(unpackArxivSource(new Blob(["%PDF-1.7 test"]))).rejects.toThrow(
		"sourceUnavailable",
	);
});
it("supports GNU long names and PAX paths without weakening path safety", () => {
	const first = tar("././@LongLink", "nested/long/main.tex\0", "L").slice(
			0,
			1024,
		),
		last = tar("ignored.tex", "test");
	const combined = new Uint8Array(first.length + last.length);
	combined.set(first);
	combined.set(last, first.length);
	expect(parseSourceTar(combined)[0].path).toBe("nested/long/main.tex");
	const value = "path=../unsafe.tex\n";
	const length = value.length + 3;
	const pax = tar("PaxHeader", `${length} ${value}`, "x").slice(0, 1024);
	combined.set(pax);
	expect(() => parseSourceTar(combined)).toThrow("invalidSourceArchive");
});
