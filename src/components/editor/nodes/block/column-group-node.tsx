"use client";

import type { TElement } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";
import { cn } from "@/lib/core/utils";

export function ColumnGroupElement(props: PlateElementProps<TElement>) {
	const children = props.element.children as TElement[];
	const count = children.length;
	const isMobile = false;

	return (
		<PlateElement
			{...props}
			className={cn(
				"grid gap-4 py-2",
				isMobile
					? "grid-cols-1"
					: "grid-cols-[repeat(var(--cols),minmax(0,1fr))]",
			)}
			style={{ "--cols": count } as React.CSSProperties}
		>
			{props.children}
		</PlateElement>
	);
}

export function ColumnElement(props: PlateElementProps<TElement>) {
	return (
		<PlateElement {...props} className="min-w-0">
			{props.children}
		</PlateElement>
	);
}
