"use client";

import { createPlatePlugin } from "platejs/react";
import { HtmlBlockElement } from "@/components/editor/nodes/block/html-node";
import { HTML_BLOCK_KEY } from "@/lib/markdown/html";

/** Verbatim HTML kept from the Markdown source, rendered sanitized. */
export const HtmlBlockPlugin = createPlatePlugin({
	key: HTML_BLOCK_KEY,
	node: { isElement: true, isVoid: true },
}).withComponent(HtmlBlockElement);
