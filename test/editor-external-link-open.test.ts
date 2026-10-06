import { createSlateEditor, KEYS } from "platejs";
import { ParagraphPlugin } from "platejs/react";
import { describe, expect, it } from "vitest";
import { LinkPlugin } from "@/components/editor/plugins/link-plugin";
import {
	clearExternalLinkEditRequest,
	insertExternalLinkNode,
	peekExternalLinkEditId,
} from "@/lib/markdown/external-link-insert";

describe("external link auto-open request", () => {
	it("stamps agenteroEditId on the node and registers the same pending id", () => {
		const editor = createSlateEditor({
			plugins: [ParagraphPlugin, LinkPlugin],
			value: [{ type: "p", children: [{ text: "x" }] }],
		});
		const result = insertExternalLinkNode(
			editor,
			{
				anchor: { path: [0, 0], offset: 1 },
				focus: { path: [0, 0], offset: 1 },
			},
			{ openEdit: true },
		);
		expect(result.editId).toBeTruthy();
		const children = (
			editor.children[0] as { children: Array<Record<string, unknown>> }
		).children;
		const link = children.find((c) => c.type === KEYS.a) as {
			agenteroEditId?: string;
		};
		expect(link.agenteroEditId).toBe(result.editId);
		expect(peekExternalLinkEditId(editor)).toBe(result.editId);
		// Simulates component opening once
		clearExternalLinkEditRequest(editor, result.editId!);
		expect(peekExternalLinkEditId(editor)).toBeNull();
		// Second clear is no-op; id on node may still exist but peek is empty
		// so UI will not re-open after dismiss.
	});
});
