/**
 * Text editor font size hook.
 *
 * Its own hook because the preference is process-wide: every open editor follows
 * the same switch through a window event, so each instance both persists and
 * listens instead of threading the value through the workspace.
 */

import { useCallback, useEffect, useState } from "react";
import {
	FONT_SIZES,
	readTextEditorFontSize,
	TEXT_EDITOR_FONT_SIZE_EVENT,
	type TextEditorFontSize,
	writeTextEditorFontSize,
} from "@/components/viewer/text-editor-font-size";

export function useTextEditorFontSize(): {
	fontSize: TextEditorFontSize;
	setFontSize: (size: TextEditorFontSize) => void;
} {
	const [fontSize, setSize] = useState<TextEditorFontSize>(
		readTextEditorFontSize,
	);

	const setFontSize = useCallback((size: TextEditorFontSize) => {
		setSize(size);
		writeTextEditorFontSize(size);
	}, []);

	useEffect(() => {
		const onFontSizeChange = (event: Event) => {
			const next = (event as CustomEvent<unknown>).detail;
			if (
				typeof next === "number" &&
				FONT_SIZES.includes(next as TextEditorFontSize)
			) {
				setSize(next as TextEditorFontSize);
			}
		};
		window.addEventListener(TEXT_EDITOR_FONT_SIZE_EVENT, onFontSizeChange);
		return () => {
			window.removeEventListener(TEXT_EDITOR_FONT_SIZE_EVENT, onFontSizeChange);
		};
	}, []);

	return { fontSize, setFontSize };
}
