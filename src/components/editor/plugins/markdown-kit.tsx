import wikiLink from "@flowershow/remark-wiki-link";
import {
	BaseFootnoteDefinitionPlugin,
	BaseFootnoteReferencePlugin,
} from "@platejs/footnote";
import { MarkdownPlugin, remarkMdx, remarkMention } from "@platejs/markdown";
import { KEYS } from "platejs";
import remarkDirective from "remark-directive";
import remarkEmoji from "remark-emoji";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { MarkdownPastePlugin } from "@/components/editor/plugins/markdown-paste-plugin";
import {
	obsidianCalloutRules,
	remarkObsidianCallout,
} from "@/lib/markdown/callout";
import { columnsRules, remarkColumns } from "@/lib/markdown/columns";
import { htmlRules, remarkPreserveHtml } from "@/lib/markdown/html";
import { imageGroupRules, remarkImageGroup } from "@/lib/markdown/image-group";
import {
	remarkWikiLinkLiteralPaths,
	wikiLinkRules,
} from "@/lib/wiki/wikilink-model";

export const MarkdownKit = [
	BaseFootnoteReferencePlugin.configure({
		options: {
			triggerQuery: (editor) => {
				const { selection } = editor;
				if (!selection || !editor.api.isCollapsed()) return true;
				const start = editor.api.before(selection, {
					distance: 2,
					unit: "character",
				});
				if (!start) return true;
				return (
					editor.api.string({
						anchor: start,
						focus: selection.anchor,
					}) !== "[["
				);
			},
		},
	}),
	BaseFootnoteDefinitionPlugin,
	MarkdownPlugin.configure({
		options: {
			plainMarks: [KEYS.suggestion, KEYS.comment],
			remarkPlugins: [
				remarkMath,
				remarkGfm,
				[wikiLink, { aliasDivider: "|" }],
				// After flowershow: keep vault `_` paths literal (no `\_` on save).
				remarkWikiLinkLiteralPaths,
				// biome-ignore lint/suspicious/noExplicitAny: remark-emoji's plugin type is incompatible with Plate's remark plugin type
				remarkEmoji as any,
				remarkMdx,
				remarkMention,
				remarkObsidianCallout,
				remarkImageGroup,
				remarkDirective,
				remarkColumns,
				remarkPreserveHtml,
			],
			rules: {
				...wikiLinkRules,
				...obsidianCalloutRules,
				...imageGroupRules,
				...columnsRules,
				...htmlRules,
			},
		},
	}),
	MarkdownPastePlugin,
];
