/**
 * Motion helpers for JS-driven animation.
 *
 * The `prefers-reduced-motion` block in index.css only caps CSS transitions and
 * keyframes. `scrollIntoView({ behavior })`, virtualizer scrolls and motion/react
 * animations are invisible to it, so every JS-driven motion has to ask here.
 *
 * Duration tokens mirror `--motion-duration-*` in index.css.
 */

/** Milliseconds — keep in sync with `:root` motion tokens in index.css. */
export const MOTION_MS = {
	micro: 100,
	fast: 150,
	normal: 200,
} as const;

export function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Behavior for programmatic scrolling ("auto" lands on the target immediately). */
export function scrollBehavior(): ScrollBehavior {
	return prefersReducedMotion() ? "auto" : "smooth";
}
