export { selectionAnchorKey } from "@/lib/pdf/selection/anchor-key";
export { marksDir } from "@/lib/pdf/selection/marks-io";
export type {
	NormalizedRect,
	PinPlacement,
	PinSide,
} from "@/lib/pdf/selection/pin";
export {
	normalizePageTextRects,
	pinFromRects,
	pinObscuresBodyText,
} from "@/lib/pdf/selection/pin";
export type {
	ActiveSelectionCard,
	SelectionPin,
} from "@/lib/pdf/selection/types";
