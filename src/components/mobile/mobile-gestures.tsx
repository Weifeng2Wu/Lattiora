import { motion, useDragControls } from "motion/react";
import { type ReactNode, type TouchEvent, useRef } from "react";

export type SwipeSummary = {
	dx: number;
	dy: number;
	fromEdge: boolean;
	durationMs: number;
};

const EDGE_WIDTH_PX = 28;

/**
 * Discrete horizontal swipe recognizer. Guards against multi-touch (pinch),
 * touchcancel leftovers, and slow drags so PDF text selection never
 * misfires navigation.
 */
export function useHorizontalSwipe(onSwipe: (swipe: SwipeSummary) => void) {
	const stateRef = useRef<{
		x: number;
		y: number;
		t: number;
		valid: boolean;
	} | null>(null);

	const onTouchStart = (event: TouchEvent<HTMLElement>) => {
		if (event.touches.length !== 1) {
			if (stateRef.current) stateRef.current.valid = false;
			return;
		}
		const touch = event.touches[0];
		stateRef.current = {
			x: touch.clientX,
			y: touch.clientY,
			t: event.timeStamp,
			valid: true,
		};
	};

	const onTouchMove = (event: TouchEvent<HTMLElement>) => {
		if (event.touches.length > 1 && stateRef.current) {
			stateRef.current.valid = false;
		}
	};

	const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
		const state = stateRef.current;
		if (event.touches.length > 0) return;
		stateRef.current = null;
		if (!state?.valid) return;
		const touch = event.changedTouches[0];
		if (!touch) return;
		onSwipe({
			dx: touch.clientX - state.x,
			dy: touch.clientY - state.y,
			fromEdge: state.x <= EDGE_WIDTH_PX,
			durationMs: event.timeStamp - state.t,
		});
	};

	const onTouchCancel = () => {
		stateRef.current = null;
	};

	return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}

/**
 * iOS-style interactive back gesture: dragging starts only from a narrow
 * left-edge strip, so touches inside the content (PDF selection, pinch
 * zoom) are never hijacked.
 */
export function EdgeSwipeBack({
	onBack,
	children,
}: {
	onBack: () => void;
	children: ReactNode;
}) {
	const controls = useDragControls();
	return (
		<div className="relative h-full min-h-0">
			<motion.div
				className="h-full min-h-0"
				drag="x"
				dragControls={controls}
				dragListener={false}
				dragConstraints={{ left: 0, right: 0 }}
				dragElastic={{ left: 0, right: 0.6 }}
				dragSnapToOrigin
				onDragEnd={(_, info) => {
					if (info.offset.x > 90 || info.velocity.x > 500) onBack();
				}}
			>
				{children}
			</motion.div>
			<div
				aria-hidden="true"
				className="absolute inset-y-0 left-0 z-10"
				style={{ width: EDGE_WIDTH_PX, touchAction: "none" }}
				onPointerDown={(event) => controls.start(event)}
			/>
		</div>
	);
}
