/// <reference types="vitest" />

import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { excalidrawAssets } from "./cloudflare/excalidraw-assets";
import { offlineShell } from "./cloudflare/offline-plugin";

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react(), tailwindcss(), excalidrawAssets(), offlineShell()],
	define: { "import.meta.env.VITE_CLOUD": JSON.stringify("1") },
	build: { outDir: "dist-web" },

	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},

	// EmbedPDF ships a PDFium WASM binary + web worker. Emit the wasm as an
	// asset, bundle the worker as an ES module, and keep Vite from pre-bundling
	// these packages (dep-optimize rewrites break their wasm/worker loading).
	assetsInclude: ["**/*.wasm"],
	worker: {
		format: "es",
	},
	optimizeDeps: {
		// PDFium + ONNX Runtime load wasm/workers; dep-optimize rewrites break them.
		exclude: [
			"@embedpdf/pdfium",
			"@embedpdf/engines",
			"onnxruntime-web",
			"@embedpdf/ai",
			// Patched in-repo. Prebundling freezes the published copy, so a
			// patch fix in plugin-tiling never reaches `vite dev`.
			"@embedpdf/plugin-tiling",
		],
	},

	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		server: {
			deps: {
				inline: [/@embedpdf\/ai/],
			},
		},
	},

	clearScreen: false,
	server: {
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8790",
				changeOrigin: true,
				headers: { origin: "http://127.0.0.1:8790" },
			},
		},
		port: 1420,
		strictPort: true,
		host: "127.0.0.1",
	},
}));
