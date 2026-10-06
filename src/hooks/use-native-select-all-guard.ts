import { useEffect } from "react";
import {
	allowsNativeSelectAll,
	isNativeSelectAllEvent,
} from "@/lib/shell/native-select-all";

/**
 * Swallow document-wide ⌘A / Ctrl+A outside text surfaces so chrome labels
 * are not selected with content. Safe to mount in every window root.
 */
export function useNativeSelectAllGuard(): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				isNativeSelectAllEvent(event) &&
				!allowsNativeSelectAll(event.target)
			) {
				event.preventDefault();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
