import { useLayoutEffect, useRef, useState } from "react";

/** Split a full line so `focus` appears once. */
export function splitLineAroundFocus(
	line: string | undefined,
	focus: string,
): { before: string; after: string } {
	if (!line || !focus) return { before: line ?? "", after: "" };
	const index = line.lastIndexOf(focus);
	if (index < 0) return { before: line, after: "" };
	return {
		before: line.slice(0, index),
		after: line.slice(index + focus.length),
	};
}

const MONO_FONT =
	'12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

let monoMeasureCanvas: HTMLCanvasElement | null = null;

export function measureMonoText(text: string): number {
	if (typeof document === "undefined" || !text) return 0;
	if (!monoMeasureCanvas) monoMeasureCanvas = document.createElement("canvas");
	const ctx = monoMeasureCanvas.getContext("2d");
	if (!ctx) return text.length * 7;
	ctx.font = MONO_FONT;
	return ctx.measureText(text).width;
}

/** Keep the right end of `text` so it fits `maxPx` (left ellipsis). */
export function fitEnd(text: string, maxPx: number): string {
	if (!text || maxPx <= 0) return "";
	if (measureMonoText(text) <= maxPx) return text;
	const ellipsis = "…";
	const ellipsisW = measureMonoText(ellipsis);
	if (maxPx <= ellipsisW) return ellipsis;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		const candidate = ellipsis + text.slice(mid);
		if (measureMonoText(candidate) <= maxPx) hi = mid;
		else lo = mid + 1;
	}
	return lo >= text.length ? ellipsis : ellipsis + text.slice(lo);
}

/** Keep the left start of `text` so it fits `maxPx` (right ellipsis). */
export function fitStart(text: string, maxPx: number): string {
	if (!text || maxPx <= 0) return "";
	if (measureMonoText(text) <= maxPx) return text;
	const ellipsis = "…";
	const ellipsisW = measureMonoText(ellipsis);
	if (maxPx <= ellipsisW) return ellipsis;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (measureMonoText(candidate) <= maxPx) lo = mid;
		else hi = mid - 1;
	}
	return lo <= 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

/**
 * Window the full line around `focus` so the core stays centered and the
 * container width shows as much surrounding context as possible.
 */
export function windowAroundFocus(
	before: string,
	focus: string,
	after: string,
	containerPx: number,
): { before: string; after: string } {
	if (containerPx <= 0) {
		return { before, after };
	}
	const focusW = Math.max(measureMonoText(focus), 24);
	const sideBudget = Math.max(0, (containerPx - focusW) / 2);
	let left = fitEnd(before, sideBudget);
	let right = fitStart(after, sideBudget);
	// Give leftover space from one side to the other.
	const usedLeft = measureMonoText(left);
	const usedRight = measureMonoText(right);
	const leftover = Math.max(0, containerPx - focusW - usedLeft - usedRight);
	if (leftover > 1) {
		if (left.startsWith("…") || measureMonoText(before) > usedLeft) {
			left = fitEnd(before, usedLeft + leftover);
		} else if (right.endsWith("…") || measureMonoText(after) > usedRight) {
			right = fitStart(after, usedRight + leftover);
		}
	}
	return { before: left, after: right };
}

export function useWindowedLine(before: string, focus: string, after: string) {
	const ref = useRef<HTMLDivElement>(null);
	const [windowed, setWindowed] = useState({ before, after });

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const update = () => {
			// Content area excludes the "+/-" gutter (~1.5rem) and horizontal padding.
			const contentPx = Math.max(0, el.clientWidth - 28);
			setWindowed(windowAroundFocus(before, focus, after, contentPx));
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, [before, focus, after]);

	return { ref, windowed };
}
