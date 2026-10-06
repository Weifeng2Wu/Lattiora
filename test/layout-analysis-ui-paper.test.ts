import { beforeEach, describe, expect, it } from "vitest";

import {
	layoutAnalysisStore,
	normalizeLayoutPaperKey,
	setLayoutAnalysisUi,
} from "@/lib/pdf/layout/store";

describe("layout analysis UI paper attribution", () => {
	beforeEach(() => {
		layoutAnalysisStore.setState({
			byDocument: {},
			ui: { stage: "idle" },
			activeDocumentId: null,
			activePaperAbsPath: null,
			focused: null,
			overlayVisible: {},
		});
	});

	it("keeps activePaperAbsPath across progress ticks for headless runs", () => {
		const paper = "/vault/papers/Attention Is All You Need";
		setLayoutAnalysisUi(
			{ stage: "running", message: "Analyzing…", progress: null },
			"headless-layout-job-1",
			paper,
		);
		expect(layoutAnalysisStore.getState().activePaperAbsPath).toBe(
			normalizeLayoutPaperKey(paper),
		);

		setLayoutAnalysisUi(
			{
				stage: "running",
				message: "Analyzing…",
				progress: 42,
				page: 3,
				total: 10,
			},
			"headless-layout-job-1",
		);
		expect(layoutAnalysisStore.getState().activePaperAbsPath).toBe(
			normalizeLayoutPaperKey(paper),
		);
		expect(layoutAnalysisStore.getState().ui).toMatchObject({
			stage: "running",
			progress: 42,
		});
	});

	it("clears activePaperAbsPath when the run finishes", () => {
		setLayoutAnalysisUi(
			{ stage: "running", message: "Analyzing…", progress: 10 },
			"headless-layout-job-1",
			"/vault/papers/a",
		);
		setLayoutAnalysisUi(
			{ stage: "done", message: "ok", total: 4 },
			"headless-layout-job-1",
		);
		expect(layoutAnalysisStore.getState().activePaperAbsPath).toBeNull();
	});
});
