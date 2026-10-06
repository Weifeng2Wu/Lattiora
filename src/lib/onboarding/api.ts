export const ONBOARDING_REQUEST_EVENT = "onboarding:request";
export const TOUR_REQUEST_EVENT = "tour:request";
export function broadcastOnboardingRequest(): void {
	window.dispatchEvent(new Event(ONBOARDING_REQUEST_EVENT));
}
export function broadcastTourRequest(): void {
	window.dispatchEvent(new Event(TOUR_REQUEST_EVENT));
}
export async function listenOnboardingRequest(
	handler: () => void,
): Promise<() => void> {
	window.addEventListener(ONBOARDING_REQUEST_EVENT, handler);
	return () => window.removeEventListener(ONBOARDING_REQUEST_EVENT, handler);
}
export async function listenTourRequest(
	handler: () => void,
): Promise<() => void> {
	window.addEventListener(TOUR_REQUEST_EVENT, handler);
	return () => window.removeEventListener(TOUR_REQUEST_EVENT, handler);
}
