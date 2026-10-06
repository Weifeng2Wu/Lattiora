/**
 * React adapter over the lib-level TeX compile store. Keeps the historical
 * TexCompileActions shape so the file tree keeps working unchanged; engine
 * state and the compile lifecycle live in @/lib/workspace/tex-compile so
 * plain actions (⌘\ split, tab buttons) can compile too.
 */

import { useCallback, useEffect } from "react";
import { useStore } from "zustand";
import { openTexPdf } from "@/lib/workspace/actions";
import {
	cleanTexAuxFiles,
	initTexEngines,
	type LatexEngine,
	selectTexEngine,
	texCompileStore,
} from "@/lib/workspace/tex-compile";
import { isTexPath } from "@/lib/workspace/viewer";

export type { LatexEngine };

export type TexCompileActions = {
	engines: LatexEngine[];
	enginesLoading: boolean;
	selectedEngine: string | null;
	selectEngine: (id: string) => void;
	compileTex: (texPath: string, vaultPath: string) => Promise<void>;
	/** latexmk -c: clear intermediates to unstick a failed-compile state. */
	cleanAux: (texPath: string) => void;
	compilingPath: string | null;
	isTexFile: (path: string) => boolean;
};

export function useTexCompile(): TexCompileActions {
	useEffect(() => {
		initTexEngines();
	}, []);

	const engines = useStore(texCompileStore, (s) => s.engines);
	const enginesLoading = useStore(texCompileStore, (s) => s.enginesLoading);
	const selectedEngine = useStore(texCompileStore, (s) => s.selectedEngine);
	const compilingPath = useStore(texCompileStore, (s) => s.compilingPath);

	const compileTex = useCallback(
		async (texPath: string, _vaultPath: string) => {
			// The compile button always recompiles: openTexPdf(forceCompile)
			// splits a shimmer placeholder beside the editor right away and
			// fills it in when the compile lands.
			await openTexPdf(texPath, { forceCompile: true });
		},
		[],
	);

	/**
	 * latexmk -c behind the engine picker's "clear intermediates" entry.
	 */
	const cleanAux = useCallback((texPath: string) => {
		void cleanTexAuxFiles(texPath);
	}, []);

	/**
	 * True when `path` is a .tex file NOT under a papers/ folder.
	 */
	const isTexFile = useCallback((path: string): boolean => {
		return isTexPath(path);
	}, []);

	return {
		engines,
		enginesLoading,
		selectedEngine,
		selectEngine: selectTexEngine,
		compileTex,
		cleanAux,
		compilingPath,
		isTexFile,
	};
}
