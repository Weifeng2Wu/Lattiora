import type { SVGProps } from "react";

/**
 * Cool Papers (papers.cool) mark — a stylized green pencil-tree, matching the
 * site's favicon. Inline because the brand has no Simple Icons glyph.
 */
export function CoolPapersIcon({
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
			<title>Cool Papers</title>
			<circle cx="12" cy="7" r="5.2" fill="#5FBB46" />
			<circle cx="6.6" cy="9.6" r="3.4" fill="#7CC94F" />
			<circle cx="17.4" cy="9.6" r="3.4" fill="#7CC94F" />
			<path d="M9.9 12.4h4.2l-1.2 8.7a.9.9 0 0 1-1.8 0z" fill="#4A9E38" />
		</svg>
	);
}
