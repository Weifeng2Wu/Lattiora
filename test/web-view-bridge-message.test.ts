import { describe, expect, it } from "vitest";

import {
	bridgeSelectionBottomRight,
	bridgeSelectionScreen,
	parseWebBridgeMessage,
} from "@/components/viewer/web-view/bridge-message";

describe("parseWebBridgeMessage", () => {
	it("parses a selection with a rect", () => {
		expect(
			parseWebBridgeMessage({
				source: "agentero-web",
				type: "selection",
				text: "quoted text",
				rect: { x: 10, y: 20, width: 100, height: 5 },
				url: "https://x.com/a",
			}),
		).toEqual({
			type: "selection",
			text: "quoted text",
			rect: { x: 10, y: 20, width: 100, height: 5 },
			url: "https://x.com/a",
		});
	});

	it("parses an emptied selection (rect may be null)", () => {
		expect(
			parseWebBridgeMessage({
				source: "agentero-web",
				type: "selection",
				text: "",
				rect: null,
				url: "https://x.com/a",
			}),
		).toEqual({
			type: "selection",
			text: "",
			rect: null,
			url: "https://x.com/a",
		});
	});

	it("drops a malformed rect rather than trusting partial numbers", () => {
		expect(
			parseWebBridgeMessage({
				source: "agentero-web",
				type: "selection",
				text: "t",
				rect: { x: 1, y: 2 },
				url: "https://x.com/a",
			})?.type,
		).toBe("selection");
		expect(
			parseWebBridgeMessage({
				source: "agentero-web",
				type: "selection",
				text: "t",
				rect: { x: 1, y: 2 },
				url: "https://x.com/a",
			}),
		).toMatchObject({ rect: null });
	});

	it("parses scroll / shortcut / external messages", () => {
		expect(
			parseWebBridgeMessage({ source: "agentero-web", type: "scroll" }),
		).toEqual({
			type: "scroll",
		});
		expect(
			parseWebBridgeMessage({
				source: "agentero-web",
				type: "shortcut",
				id: "quickChat",
			}),
		).toEqual({ type: "shortcut", id: "quickChat" });
		expect(
			parseWebBridgeMessage({
				source: "agentero-web",
				type: "external",
				url: "https://y.com",
			}),
		).toEqual({ type: "external", url: "https://y.com" });
	});

	it("refuses foreign or malformed payloads", () => {
		// Spoofed marker from an unrelated frame.
		expect(
			parseWebBridgeMessage({ source: "evil", type: "scroll" }),
		).toBeNull();
		expect(parseWebBridgeMessage({ type: "scroll" })).toBeNull();
		expect(parseWebBridgeMessage("agentero-web")).toBeNull();
		expect(parseWebBridgeMessage(null)).toBeNull();
		// Known type, bad payload.
		expect(
			parseWebBridgeMessage({ source: "agentero-web", type: "external" }),
		).toBeNull();
		expect(
			parseWebBridgeMessage({
				source: "agentero-web",
				type: "shortcut",
				id: "x",
			}),
		).toBeNull();
		expect(
			parseWebBridgeMessage({
				source: "agentero-web",
				type: "selection",
				text: 1,
			}),
		).toBeNull();
	});
});

describe("bridgeSelectionScreen", () => {
	it("maps the frame-viewport rect into the app viewport", () => {
		expect(
			bridgeSelectionScreen(
				{ x: 100, y: 200, width: 60, height: 8 },
				{ x: 40, y: 12 },
			),
		).toEqual({ x: 170, y: 212 });
	});
});

describe("bridgeSelectionBottomRight", () => {
	it("anchors at the selection's bottom-right corner (translate cards)", () => {
		expect(
			bridgeSelectionBottomRight(
				{ x: 100, y: 200, width: 60, height: 8 },
				{ x: 40, y: 12 },
			),
		).toEqual({ x: 200, y: 220 });
	});
});
