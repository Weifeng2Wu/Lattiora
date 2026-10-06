import type { ComponentType } from "react";
import type { PaperMetadata } from "@/lib/paper/types";

/** Export format chosen in the dialog. */
export type MarkdownExportFormat = "pdf" | "png" | "md";

/** Options applied for a single export run. */
export type MarkdownExportOptions = {
	format: MarkdownExportFormat;
	/** Expand embed shells past editor max-height. Default true. */
	expandEmbeds: boolean;
	/**
	 * When the note is a paper `NOTES.md`, prepend title / authors / link.
	 * Ignored for non-paper notes. Default true when paper meta is available.
	 */
	includePaperHeader: boolean;
	/** Semi-transparent “Agentero” corner watermark. Default from settings. */
	watermark: boolean;
};

export type MarkdownExportPaperHeader = {
	title: string;
	authorsLine: string | null;
	year: number | null;
	link: string | null;
	linkLabel: string | null;
};

/**
 * Props of the offscreen render surface. The runner mounts this component in a
 * detached React root; it is injected by the caller so lib never imports a
 * React component from the components layer.
 */
export type MarkdownExportSurfaceProps = {
	markdown: string;
	filePath: string | null;
	expandEmbeds: boolean;
	paperHeader: MarkdownExportPaperHeader | null;
	onMounted: (el: HTMLElement) => void;
};

/** Renderable surface component injected into {@link runMarkdownExport}. */
export type MarkdownExportSurfaceComponent =
	ComponentType<MarkdownExportSurfaceProps>;

export type MarkdownExportRequest = {
	/**
	 * Full Markdown including optional frontmatter. Frontmatter is vault-
	 * internal metadata and stripped by every export path (render + `.md`).
	 */
	markdown: string;
	/** Absolute path of the source note (asset / wiki resolve). */
	filePath: string | null;
	/**
	 * Active Vault root for wiki embed resolution.
	 * Required because export mounts a separate React root without app providers.
	 */
	vaultPath: string | null;
	/** Vault wiki target files (annotation recovery / link resolve helpers). */
	mdFiles?: string[];
	/** Suggested filename stem (no extension). */
	defaultName: string;
	options: MarkdownExportOptions;
	/** Pre-resolved paper header; null when not a paper note or disabled. */
	paperHeader: MarkdownExportPaperHeader | null;
};

export type MarkdownExportResult =
	| { status: "cancelled" }
	| { status: "saved"; path: string; format: MarkdownExportFormat };

export type ResolvePaperHeaderInput = {
	filePath: string | null;
	vaultPath: string | null;
	paperMetaByRelPath: ReadonlyMap<string, PaperMetadata> | null | undefined;
};
