import { rm } from "node:fs/promises";

await rm(new URL("../dist-web", import.meta.url), {
	recursive: true,
	force: true,
});
