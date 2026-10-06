"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";
import { cn } from "@/lib/core/utils";

/*
 * Heading sizes step down with the editor pane width (`@container/editor` in
 * markdown-editor): at ~200px a fixed text-4xl h1 wraps one word per line.
 * Without that named container (export surface, embeds) the base size applies.
 */
const headingVariants = cva(
	// Document-start spacing is applied from `path` (not :first-child): block
	// drag wrappers make every heading the first child of its own parent.
	"relative mb-1 transition-colors duration-300 data-[nav-target=true]:rounded-md data-[nav-target=true]:bg-highlight/20",
	{
		variants: {
			variant: {
				h1: "mt-6 pb-1 font-bold font-heading text-4xl @max-sm/editor:text-3xl @max-2xs/editor:text-2xl",
				h2: "mt-6 pb-px font-heading font-semibold text-2xl tracking-tight @max-2xs/editor:text-xl",
				h3: "mt-6 pb-px font-heading font-semibold text-xl tracking-tight @max-2xs/editor:text-lg",
				h4: "mt-4 font-heading font-semibold text-lg tracking-tight",
				h5: "mt-4 font-semibold text-lg tracking-tight",
				h6: "mt-4 font-semibold text-base tracking-tight",
			},
		},
	},
);

export function HeadingElement({
	variant = "h1",
	...props
}: PlateElementProps & VariantProps<typeof headingVariants>) {
	const isDocumentStart =
		Array.isArray(props.path) && props.path.length === 1 && props.path[0] === 0;
	const attributes = {
		...props.attributes,
		// @platejs/toc 53.0.0 identifies IntersectionObserver targets by DOM
		// `id`. Plate 53.2.x only emits `data-block-id`, so mirror the node id.
		id: typeof props.element.id === "string" ? props.element.id : undefined,
	};

	return (
		<PlateElement
			as={variant ?? "h1"}
			className={cn(headingVariants({ variant }), isDocumentStart && "mt-0")}
			{...props}
			attributes={attributes}
		>
			{props.children}
		</PlateElement>
	);
}

export function H1Element(props: PlateElementProps) {
	return <HeadingElement variant="h1" {...props} />;
}

export function H2Element(props: PlateElementProps) {
	return <HeadingElement variant="h2" {...props} />;
}

export function H3Element(props: PlateElementProps) {
	return <HeadingElement variant="h3" {...props} />;
}

export function H4Element(props: PlateElementProps) {
	return <HeadingElement variant="h4" {...props} />;
}

export function H5Element(props: PlateElementProps) {
	return <HeadingElement variant="h5" {...props} />;
}

export function H6Element(props: PlateElementProps) {
	return <HeadingElement variant="h6" {...props} />;
}
