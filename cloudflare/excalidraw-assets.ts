import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Excalidraw resolves drawing fonts at runtime, outside Vite's import graph. */
export function excalidrawAssets(): Plugin {
	let build = false;
	const root = path.resolve(
		"node_modules/@excalidraw/excalidraw/dist/prod/fonts",
	);
	const fonts = readdirSync(root, { recursive: true }).filter(
		(file): file is string =>
			typeof file === "string" && file.endsWith(".woff2"),
	);
	return {
		name: "agentero-excalidraw-fonts",
		configResolved(config) {
			build = config.command === "build";
		},
		buildStart() {
			if (!build) return;
			for (const file of fonts)
				this.emitFile({
					type: "asset",
					fileName: `excalidraw/fonts/${file.replaceAll(path.sep, "/")}`,
					source: readFileSync(path.join(root, file)),
				});
		},
		configureServer(server) {
			const urls = new Map(
				fonts.map((file) => [
					`/excalidraw/fonts/${file.replaceAll(path.sep, "/")}`,
					file,
				]),
			);
			server.middlewares.use((request, response, next) => {
				const file = urls.get((request.url ?? "").split("?")[0]);
				if (!file) return next();
				response.setHeader("Content-Type", "font/woff2");
				response.end(readFileSync(path.join(root, file)));
			});
		},
	};
}
