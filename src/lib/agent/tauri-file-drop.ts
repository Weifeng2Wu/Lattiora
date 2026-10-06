export function isClientPointInRect(
	x: number,
	y: number,
	rect: DOMRect,
): boolean {
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
