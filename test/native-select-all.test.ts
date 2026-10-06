import { describe, expect, it } from "vitest";
import {
	allowsNativeSelectAll,
	isNativeSelectAllEvent,
} from "@/lib/shell/native-select-all";

function keyEvent(init: {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	defaultPrevented?: boolean;
}): KeyboardEvent {
	return {
		key: init.key,
		metaKey: init.metaKey ?? false,
		ctrlKey: init.ctrlKey ?? false,
		altKey: init.altKey ?? false,
		shiftKey: init.shiftKey ?? false,
		defaultPrevented: init.defaultPrevented ?? false,
	} as KeyboardEvent;
}

/** Minimal Element stand-in — vitest here has no happy-dom. */
function fakeTarget(matchSelector: boolean): EventTarget {
	return {
		closest: (_selector: string) => (matchSelector ? {} : null),
	} as unknown as Element;
}

describe("native select-all gating", () => {
	it("recognizes ⌘A / Ctrl+A but not ⇧⌘A", () => {
		expect(isNativeSelectAllEvent(keyEvent({ key: "a", metaKey: true }))).toBe(
			true,
		);
		expect(isNativeSelectAllEvent(keyEvent({ key: "a", ctrlKey: true }))).toBe(
			true,
		);
		expect(
			isNativeSelectAllEvent(
				keyEvent({ key: "a", metaKey: true, shiftKey: true }),
			),
		).toBe(false);
		expect(
			isNativeSelectAllEvent(
				keyEvent({ key: "a", metaKey: true, altKey: true }),
			),
		).toBe(false);
		expect(
			isNativeSelectAllEvent(
				keyEvent({
					key: "a",
					metaKey: true,
					defaultPrevented: true,
				}),
			),
		).toBe(false);
	});

	it("allows select-all only when closest hits a text surface", () => {
		expect(allowsNativeSelectAll(null)).toBe(false);
		expect(allowsNativeSelectAll(fakeTarget(false))).toBe(false);
		expect(allowsNativeSelectAll(fakeTarget(true))).toBe(true);
		expect(allowsNativeSelectAll({} as EventTarget)).toBe(false);
	});
});
