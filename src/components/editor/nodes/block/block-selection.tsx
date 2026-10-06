"use client";

import { useBlockSelected } from "@platejs/selection/react";
import type { PlateElementProps } from "platejs/react";

import { cn } from "@/lib/core/utils";
import { isBlankParagraph } from "@/lib/markdown/block-selection";

export function hasSelectableClass({
	attributes,
	className,
}: {
	attributes?: { className?: string };
	className?: string;
}): boolean {
	return [className, attributes?.className]
		.filter(Boolean)
		.join(" ")
		.includes("slate-selectable");
}

/** Tint over a block currently in the block-selection set. */
export function BlockSelection(props: PlateElementProps) {
	const isBlockSelected = useBlockSelected();

	if (
		!isBlockSelected ||
		props.plugin.key === "tr" ||
		props.plugin.key === "table" ||
		isBlankParagraph(props.element)
	) {
		return null;
	}

	return (
		<div
			className={cn(
				"pointer-events-none absolute inset-0 z-1 rounded-md bg-foreground/10",
				// The drag preview stands in for the selection while dragging.
				// Attribute comes from BlockDragStateBridge.
				"[[data-dnd-dragging]_&]:opacity-0",
			)}
			data-slot="block-selection"
		/>
	);
}
