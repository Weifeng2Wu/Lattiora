/**
 * File-tree imperative handle registry (collapse / cut / paste commands from
 * the palette / shortcuts without threading the ref through the command layer).
 */

import type { FileTreeHandle } from "@/components/sidebar/file-tree";

let handle: FileTreeHandle | null = null;

export function registerFileTreeHandle(next: FileTreeHandle | null): void {
	handle = next;
}

export function fileTreeHandle(): FileTreeHandle | null {
	return handle;
}
