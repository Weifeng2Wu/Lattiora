import type { DockviewApi } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	rememberNotesSplitWidth,
	restoreNotesSplitWidth,
} from "@/lib/workspace/notes-split-width";

function dock(paperWidth = 700, notesWidth = 300, vertical = false) {
	const group = (left: number, top: number, width: number) => ({
		api: {
			location: { type: "grid" },
			boundingBox: { left, top, width, height: 600 },
			setSize: vi.fn(),
		},
	});
	const paper = group(0, 0, paperWidth);
	const notes = group(
		vertical ? 0 : paperWidth,
		vertical ? 600 : 0,
		notesWidth,
	);
	const api = {
		groups: [paper, notes],
		getPanel: (id: string) => ({ group: id === "paper" ? paper : notes }),
	} as unknown as DockviewApi;
	return { api, paper, notes };
}

beforeEach(() => {
	const data = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => data.set(key, value),
	});
});

afterEach(() => vi.unstubAllGlobals());

describe("shared Notes split width", () => {
	it("restores 70:30 after recreating the split at a different window size", () => {
		rememberNotesSplitWidth(dock().api, "paper", "notes");
		const reopened = dock(600, 600);
		restoreNotesSplitWidth(reopened.api, "paper", "notes");
		expect(reopened.notes.api.setSize).toHaveBeenCalledWith({ width: 360 });
		expect(reopened.paper.api.setSize).not.toHaveBeenCalled();
	});
	it("leaves the default layout alone without a stored ratio", () => {
		const current = dock();
		restoreNotesSplitWidth(current.api, "paper", "notes");
		expect(current.notes.api.setSize).not.toHaveBeenCalled();
	});
	it("does not overwrite the preference or resize a vertical arrangement", () => {
		rememberNotesSplitWidth(dock().api, "paper", "notes");
		const vertical = dock(1000, 1000, true);
		rememberNotesSplitWidth(vertical.api, "paper", "notes");
		restoreNotesSplitWidth(vertical.api, "paper", "notes");
		expect(vertical.notes.api.setSize).not.toHaveBeenCalled();
		const reopened = dock(500, 500);
		restoreNotesSplitWidth(reopened.api, "paper", "notes");
		expect(reopened.notes.api.setSize).toHaveBeenCalledWith({ width: 300 });
	});
	it("does not rearrange a workspace with additional columns", () => {
		rememberNotesSplitWidth(dock().api, "paper", "notes");
		const current = dock();
		current.api.groups.push(
			current.paper as unknown as DockviewApi["groups"][number],
		);
		restoreNotesSplitWidth(current.api, "paper", "notes");
		expect(current.notes.api.setSize).not.toHaveBeenCalled();
	});
});
