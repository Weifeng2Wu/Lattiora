import { describe, expect, it } from "vitest";
import { settleMarkdownSaveAttempt } from "../src/lib/markdown/save-state";

describe("Markdown save state", () => {
	it("keeps the confirmed snapshot and dirty state after a failed write", () => {
		expect(
			settleMarkdownSaveAttempt({
				attemptedMarkdown: "draft",
				currentMarkdown: "draft",
				lastSaved: "disk",
				persisted: false,
			}),
		).toEqual({
			savedMarkdown: "disk",
			dirty: true,
			retryLatest: false,
		});
	});

	it("clears dirty only after the attempted Markdown reaches disk", () => {
		expect(
			settleMarkdownSaveAttempt({
				attemptedMarkdown: "saved",
				currentMarkdown: "saved",
				lastSaved: "disk",
				persisted: true,
			}),
		).toEqual({
			savedMarkdown: "saved",
			dirty: false,
			retryLatest: false,
		});
	});

	it("queues edits made while a successful write is in flight", () => {
		expect(
			settleMarkdownSaveAttempt({
				attemptedMarkdown: "first save",
				currentMarkdown: "newer draft",
				lastSaved: "disk",
				persisted: true,
			}),
		).toEqual({
			savedMarkdown: "first save",
			dirty: true,
			retryLatest: true,
		});
	});
});
