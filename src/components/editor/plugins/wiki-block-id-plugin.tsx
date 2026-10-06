"use client";

import {
	createPlatePlugin,
	PlateLeaf,
	type PlateLeafProps,
} from "platejs/react";
import { findWikiBlockIdRange } from "@/lib/wiki/navigation";

function WikiBlockIdLeaf(props: PlateLeafProps) {
	return (
		<PlateLeaf {...props} className="text-[0.75em] text-muted-foreground" />
	);
}

/** Ephemeral Live Preview styling for valid trailing `^block-id` markers. */
export const WikiBlockIdPlugin = createPlatePlugin({
	key: "wikiBlockId",
	node: { isLeaf: true },
	decorate: ({ editor, entry: [node, path] }) => {
		if (
			typeof node !== "object" ||
			node === null ||
			!("text" in node) ||
			typeof node.text !== "string" ||
			("code" in node && node.code)
		) {
			return;
		}
		const parent = editor.api.parent(path)?.[0] as
			| { type?: unknown }
			| undefined;
		if (parent?.type === "code_line") return;
		const range = findWikiBlockIdRange(node.text);
		if (!range) return;
		return [
			{
				anchor: { path, offset: range.start },
				focus: { path, offset: range.end },
				wikiBlockId: true,
			},
		];
	},
}).withComponent(WikiBlockIdLeaf);
