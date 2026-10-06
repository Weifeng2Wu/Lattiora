import { downloadBlob, exportBackup } from "./backup";
import { exportBibliography, importBibliography } from "./bibliography";
import { createCloudPaper } from "./catalog";
import { listLocalFiles, writeLocalFile } from "./files";
import { MAX_FILE_BYTES } from "./protocol";

export function pickFiles(accept = "", multiple = true): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.multiple = multiple;
		input.onchange = () => resolve([...(input.files ?? [])]);
		input.oncancel = () => resolve([]);
		input.click();
	});
}
export async function importPdfFiles(
	files: File[],
	parent = "papers",
): Promise<string[]> {
	const paths: string[] = [];
	for (const file of files) {
		if (file.size > MAX_FILE_BYTES) throw new Error("tooLarge");
		if (!(await file.slice(0, 1024).text()).includes("%PDF-"))
			throw new Error("invalidPdf");
		const paper = await createCloudPaper(
			file.name.replace(/\.pdf$/i, ""),
			parent,
			{ type: "pdf" },
		);
		await writeLocalFile(
			`${paper.path}/paper.pdf`,
			new Blob([file], { type: "application/pdf" }),
		);
		const { enqueuePdfRecognition } = await import("./recognition");
		await enqueuePdfRecognition(paper, file);
		paths.push(paper.path);
	}
	return paths;
}
export async function pickAndImportPdfs(parent = "papers"): Promise<string[]> {
	return importPdfFiles(await pickFiles(".pdf,application/pdf"), parent);
}
export async function pickAndImportBibliography(
	parent = "papers",
): Promise<void> {
	for (const file of await pickFiles(".bib,.ris,.json,.xml,.rdf,.enw,.nbib"))
		await importBibliography(await file.text(), parent);
}
export async function downloadBibliography(format = "bibtex"): Promise<void> {
	const exported = await exportBibliography(format);
	downloadBlob(
		new Blob([exported.content], { type: "text/plain;charset=utf-8" }),
		exported.filename,
	);
}

export async function pickAndImportFiles(): Promise<void> {
	for (const file of await pickFiles()) {
		let path = `notes/${file.name}`;
		if (
			(await listLocalFiles()).some((old) => !old.deleted && old.path === path)
		)
			path = `notes/${crypto.randomUUID().slice(0, 8)}-${file.name}`;
		await writeLocalFile(path, file);
	}
}
export async function downloadWorkspaceBackup(): Promise<void> {
	downloadBlob(
		await exportBackup(),
		`agentero-${new Date().toISOString().slice(0, 10)}.zip`,
	);
}
