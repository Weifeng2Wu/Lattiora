/**
 * LaTeX engine state and compile lifecycle for .tex files, kept in a lib-level
 * store so plain workspace actions (⌘\ split, tab buttons) can compile too —
 * not just the file-tree React hook. Mirrors the vaultStore vanilla-store
 * pattern; the hook stays a thin adapter.
 */

import { createStore } from "zustand/vanilla";
import i18n from "@/i18n";
import { notifyError } from "@/lib/core/notify";

export type LatexEngine = {
	id: string;
	label: string;
	path: string | null;
};

type TexCompileState = {
	engines: LatexEngine[];
	enginesLoading: boolean;
	selectedEngine: string | null;
	compilingPath: string | null;
};

export const texCompileStore = createStore<TexCompileState>(() => ({
	engines: [],
	enginesLoading: false,
	selectedEngine: null,
	compilingPath: null,
}));

export async function ensureTexEngines(): Promise<void> {
	throw new Error(i18n.t("cloud:errors.nativeCompile"));
}
export function initTexEngines(): void {
	/* Web builds do not enumerate native engines. */
}
export function selectTexEngine(_id: string): void {
	notifyError(i18n.t("cloud:errors.nativeCompile"));
}
export async function cleanTexAuxFiles(_path: string): Promise<boolean> {
	throw new Error(i18n.t("cloud:errors.nativeCompile"));
}
