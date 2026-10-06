/**
 * Shared thresholds for the figures rail and PDF layout hit targets.
 */

/** Default confidence gate (0–1) for sidebar gallery + hover hit targets. */
export const LAYOUT_SIDEBAR_MIN_SCORE = 0.3;

/**
 * Minimum on-screen region size (px) before the「单击进行批注」hint chip is drawn.
 * The chip is a fixed-size label living inside a box that scales with zoom, so
 * on anything smaller it would spill past the region and cover its neighbours.
 */
export const LAYOUT_HINT_MIN_REGION_W_PX = 120;
export const LAYOUT_HINT_MIN_REGION_H_PX = 28;
