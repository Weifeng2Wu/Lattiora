import type { SVGProps } from "react";

/**
 * ModelScope (魔搭) mark — the favicon's white pixel bowtie on its violet tile,
 * squared off so it still reads at sidebar size. Inline because the brand has no
 * Simple Icons glyph.
 */
export function ModelScopeIcon({
	className,
	...props
}: SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			className={className}
			aria-hidden
			{...props}
		>
			<title>ModelScope</title>
			<rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#624AFF" />
			<g fill="#ffffff">
				<rect x="4" y="8" width="3" height="3" />
				<rect x="7.5" y="10.5" width="3" height="3" />
				<rect x="4" y="13" width="3" height="3" />
				<rect x="17" y="8" width="3" height="3" />
				<rect x="13.5" y="10.5" width="3" height="3" />
				<rect x="17" y="13" width="3" height="3" />
			</g>
		</svg>
	);
}
