/**
 * Public surface of the vault sidebar file tree.
 *
 * Everything else under `file-tree/` is internal: `hooks/` (tree state),
 * `tree-rows.tsx` (row renderers), `tree-rows-viewport.tsx` (windowed list),
 * `tree-context-menu.tsx` (right-click menu portal), `tree-inputs.tsx` (inline
 * create/rename), `move-picker-popover.tsx`,
 * `move-destination-picker.tsx`, `tree-helpers.ts`, and `types.ts`. Import
 * those paths only from within `file-tree/` — never import this barrel from
 * inside the folder (import cycle).
 */

export {
	FileTree,
	type FileTreeHandle,
} from "@/components/sidebar/file-tree/file-tree";
export type {
	TreeCreateDraft,
	TreeCreateKind,
	TreeRenameDraft,
} from "@/components/sidebar/file-tree/types";
export type { VaultSidebarHeaderProps } from "@/components/sidebar/vault-sidebar-header";
export { VaultSidebarHeader } from "@/components/sidebar/vault-sidebar-header";
