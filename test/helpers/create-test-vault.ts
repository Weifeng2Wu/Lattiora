import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type TestVault = {
	root: string;
	cleanup: () => Promise<void>;
	listMarkdownFiles: () => Promise<string[]>;
};

export async function createTestVault(
	files: Record<string, string>,
): Promise<TestVault> {
	const root = await mkdtemp(path.join(tmpdir(), "agentero-vault-"));

	for (const [rel, content] of Object.entries(files)) {
		const fullPath = path.join(root, rel);
		await mkdir(path.dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content, "utf8");
	}

	return {
		root,
		cleanup: () => rm(root, { recursive: true, force: true }),
		listMarkdownFiles: () => listMarkdownFiles(root),
	};
}

async function listMarkdownFiles(root: string): Promise<string[]> {
	const out: string[] = [];

	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir);
		for (const entry of entries) {
			const fullPath = path.join(dir, entry);
			const info = await stat(fullPath);
			if (info.isDirectory()) {
				await walk(fullPath);
			} else if (/\.(md|mdx|markdown)$/i.test(entry)) {
				out.push(path.relative(root, fullPath).replaceAll(path.sep, "/"));
			}
		}
	}

	await walk(root);
	return out.sort((a, b) => a.localeCompare(b));
}
