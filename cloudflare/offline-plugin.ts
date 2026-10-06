import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/** Cache a complete, versioned application shell, including lazy viewers/WASM.
 * New versions wait for existing tabs to close; never reload a dirty editor. */
export function offlineShell(): Plugin {
	return {
		name: "agentero-offline-shell",
		apply: "build",
		generateBundle(_options, bundle) {
			const files = Object.keys(bundle)
				.filter((name) => !name.endsWith(".map") && name !== "index.html")
				.map((name) => `/${name}`);
			files.push("/");
			const version = createHash("sha256")
				.update(JSON.stringify(files))
				.digest("hex")
				.slice(0, 16);
			this.emitFile({
				type: "asset",
				fileName: "sw.js",
				source: `
const CACHE = 'agentero-shell-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil((async () => {
 const cache = await caches.open(CACHE);
 let index = 0;
 await Promise.all(Array.from({length: 4}, async () => {
  while (index < FILES.length) { const path = FILES[index++]; await cache.add(new Request(path, {cache: 'reload'})); }
 }));
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
 for (const name of await caches.keys()) if (name.startsWith('agentero-shell-') && name !== CACHE) await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
 const request = event.request, url = new URL(request.url);
 if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
 if (url.pathname.startsWith('/_reader/')) {
  event.respondWith((async () => await (await caches.open('agentero-html-preview-v1')).match(request) || new Response('Not found', {status:404,headers:{'content-type':'text/plain'}}))());
  return;
 }
 if (request.mode === 'navigate') {
  event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match('/')));
 } else {
  event.respondWith((async () => {
   const cache = await caches.open(CACHE);
   return await cache.match(request) || fetch(request);
  })());
 }
});
`,
			});
		},
	};
}
