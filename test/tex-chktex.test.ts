import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chktexLintMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/core/bindings", () => ({
	commands: {
		chktexLint: chktexLintMock,
	},
}));

import {
	type ChktexFinding,
	chktexDiagnostics,
	texChktexLintSource,
} from "@/components/viewer/text-editor-language";

const ELLIPSIS: ChktexFinding = {
	// Matches "A bad ellipsis... here." — the `...` starts at column 15.
	line: 1,
	column: 15,
	length: 3,
	severity: "warning",
	code: 11,
	message: "You should use \\ldots to achieve an ellipsis.",
};

beforeEach(() => {
	chktexLintMock.mockReset();
});

describe("chktexDiagnostics", () => {
	it("maps 1-based line/column/length to editor offsets", () => {
		const { doc } = EditorState.create({
			doc: "A bad ellipsis... here.\nsecond line\n",
		});
		const diagnostics = chktexDiagnostics([ELLIPSIS], doc);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].from).toBe(14);
		expect(diagnostics[0].to).toBe(17);
		expect(diagnostics[0].severity).toBe("warning");
		expect(diagnostics[0].source).toBe("chktex");
		expect(diagnostics[0].message).toContain("(chktex 11)");
	});

	it("keeps the warning number so `%chktex <n>` suppression is discoverable", () => {
		const { doc } = EditorState.create({ doc: "x\n" });
		const [diagnostic] = chktexDiagnostics(
			[{ ...ELLIPSIS, code: 8, message: "Wrong length of dash." }],
			doc,
		);
		expect(diagnostic.message).toBe("Wrong length of dash. (chktex 8)");
	});

	it("maps error/info kinds and coerces unknowns to warning", () => {
		const { doc } = EditorState.create({ doc: "x\n" });
		const severities = chktexDiagnostics(
			[
				{ ...ELLIPSIS, severity: "Error" },
				{ ...ELLIPSIS, severity: "Message" },
				{ ...ELLIPSIS, severity: "?" },
			],
			doc,
		).map((d) => d.severity);
		// The Rust side normalizes kinds to error/warning/info already; the
		// mapper just narrows the string, defaulting anything else.
		expect(severities).toEqual(["warning", "warning", "warning"]);
	});

	it("drops out-of-range lines and clamps spans to the document", () => {
		const { doc } = EditorState.create({ doc: "short\nsecond line\n" });
		const diagnostics = chktexDiagnostics(
			[
				{ ...ELLIPSIS, line: 99 },
				{ ...ELLIPSIS, line: 2, column: 500, length: 100 },
			],
			doc,
		);
		expect(diagnostics).toHaveLength(1);
		const clamped = diagnostics[0];
		// Column 500 on line 2 clamps to the line end; length clamps to doc end.
		expect(clamped.from).toBe(doc.line(2).to);
		expect(clamped.to).toBe(doc.length);
	});
});

describe("texChktexLintSource", () => {
	it("lints the live buffer and maps the findings", async () => {
		chktexLintMock.mockResolvedValue({ ok: true, data: [ELLIPSIS] });
		const state = EditorState.create({
			doc: "A bad ellipsis... here.\n",
		});
		const diagnostics = await texChktexLintSource("/vault/thesis/main.tex")({
			state,
		} as never);
		expect(chktexLintMock).toHaveBeenCalledWith(
			"/vault/thesis/main.tex",
			"A bad ellipsis... here.\n",
		);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].from).toBe(14);
	});

	it("stays silent on a backend error, null data or a thrown invoke", async () => {
		const state = EditorState.create({ doc: "x\n" });
		const view = { state } as never;
		chktexLintMock.mockResolvedValue({
			ok: false,
			data: null,
			error: { code: "message", message: "chktex timed out" },
		});
		expect(await texChktexLintSource("/a.tex")(view)).toEqual([]);
		chktexLintMock.mockResolvedValue({ ok: true, data: null });
		expect(await texChktexLintSource("/a.tex")(view)).toEqual([]);
		chktexLintMock.mockRejectedValue(new Error("ipc gone"));
		expect(await texChktexLintSource("/a.tex")(view)).toEqual([]);
	});
});
