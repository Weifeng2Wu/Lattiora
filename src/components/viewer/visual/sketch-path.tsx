import { useMemo } from "react";
import rough from "roughjs";

const generator = rough.generator();

/** Stable seeds keep the hand-drawn strokes still while typing or dragging. */
export function SketchPath({
	id,
	d,
	color,
	fill = false,
}: {
	id: string;
	d: string;
	color: string;
	fill?: boolean;
}) {
	const paths = useMemo(() => {
		let seed = 1;
		for (const char of id)
			seed = (Math.imul(seed, 31) + char.charCodeAt(0)) | 0;
		return generator.toPaths(
			generator.path(d, {
				seed: seed >>> 0 || 1,
				roughness: 0.85,
				bowing: 1,
				stroke: color,
				strokeWidth: 1.5,
				fill: fill ? color : undefined,
				fillStyle: "solid",
			}),
		);
	}, [id, d, color, fill]);
	return (
		<>
			{paths.map((path) => (
				<path
					key={path.d}
					d={path.d}
					stroke={path.stroke}
					strokeWidth={path.strokeWidth}
					fill={path.fill}
					fillOpacity={0.09}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			))}
		</>
	);
}
