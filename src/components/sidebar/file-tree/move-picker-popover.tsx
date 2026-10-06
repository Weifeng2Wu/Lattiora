/** Popover shell that anchors the move-destination picker inside the tree. */
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import type { FileNode } from "@/lib/vault";
import type { MovePicker } from "./hooks/use-move-picker";
import { MoveDestinationPicker } from "./move-destination-picker";

export function MovePickerPopover({
	picker,
	vaultPath,
	nodes,
}: {
	picker: MovePicker;
	vaultPath: string | null;
	nodes: FileNode[];
}) {
	return (
		<Popover
			open={picker.open}
			onOpenChange={(open) => {
				if (!open) picker.close();
			}}
		>
			<PopoverAnchor asChild>
				<div
					className="absolute size-0"
					style={
						picker.anchorPos
							? { left: picker.anchorPos.x, top: picker.anchorPos.y }
							: undefined
					}
				/>
			</PopoverAnchor>
			<MoveDestinationPicker
				vaultPath={vaultPath}
				nodes={nodes}
				sourcePaths={picker.targets}
				selectedFolder={picker.selectedFolder}
				newFolder={picker.newFolder}
				busy={picker.busy}
				onNewFolderChange={picker.setNewFolder}
				onConfirm={picker.confirm}
			/>
		</Popover>
	);
}
