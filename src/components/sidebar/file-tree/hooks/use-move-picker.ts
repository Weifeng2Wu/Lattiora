/**
 * Inline "move to papers/ folder" picker: anchor position (relative to the tree
 * container), pending targets, and the confirm round-trip.
 */
import { type RefObject, useCallback, useState } from "react";

/** Destination preselected when the picker opens. */
const DEFAULT_DEST_FOLDER = "papers";

export type MovePickerAnchor = { x: number; y: number };

export type MovePicker = {
	open: boolean;
	targets: string[];
	selectedFolder: string;
	newFolder: string;
	setNewFolder: (value: string) => void;
	busy: boolean;
	anchorPos: MovePickerAnchor | null;
	openPicker: (paths: string[], anchor?: MovePickerAnchor) => void;
	close: () => void;
	confirm: (dest: string) => Promise<void>;
};

export function useMovePicker({
	containerRef,
	onMoveTo,
	onMoved,
}: {
	containerRef: RefObject<HTMLDivElement | null>;
	onMoveTo?: (paths: string[], destParentRel: string) => void;
	/** Called after a successful move (clears the multi-selection). */
	onMoved: () => void;
}): MovePicker {
	const [open, setOpen] = useState(false);
	const [targets, setTargets] = useState<string[]>([]);
	const [newFolder, setNewFolder] = useState("");
	const [busy, setBusy] = useState(false);
	const [anchorPos, setAnchorPos] = useState<MovePickerAnchor | null>(null);

	const openPicker = useCallback(
		(paths: string[], anchor?: MovePickerAnchor) => {
			if (paths.length === 0 || !onMoveTo) return;
			setTargets(paths);
			setNewFolder("");
			const container = containerRef.current;
			if (anchor && container) {
				const rect = container.getBoundingClientRect();
				setAnchorPos({ x: anchor.x - rect.left, y: anchor.y - rect.top });
			} else {
				setAnchorPos(anchor ?? null);
			}
			setOpen(true);
		},
		[onMoveTo, containerRef],
	);

	const close = useCallback(() => setOpen(false), []);

	const confirm = useCallback(
		async (dest: string) => {
			if (!onMoveTo) return;
			setBusy(true);
			try {
				await onMoveTo(targets, dest);
			} finally {
				setBusy(false);
				setOpen(false);
				setTargets([]);
				setAnchorPos(null);
				onMoved();
			}
		},
		[onMoveTo, targets, onMoved],
	);

	return {
		open,
		targets,
		selectedFolder: DEFAULT_DEST_FOLDER,
		newFolder,
		setNewFolder,
		busy,
		anchorPos,
		openPicker,
		close,
		confirm,
	};
}
