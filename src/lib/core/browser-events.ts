/** Renderer-local events for the retained typed UI contracts. File changes use
 * the IndexedDB/BroadcastChannel layer; these events never imply native work. */
export type UnlistenFn = () => void;
export type Event<T> = { event: string; id: number; payload: T };
export type EventCallback<T> = (event: Event<T>) => void;
const bus = new EventTarget();
export async function listen<T>(
	name: string,
	callback: EventCallback<T>,
): Promise<UnlistenFn> {
	const listener = (event: globalThis.Event) =>
		callback({ event: name, id: 0, payload: (event as CustomEvent<T>).detail });
	bus.addEventListener(name, listener);
	return () => bus.removeEventListener(name, listener);
}
export async function once<T>(
	name: string,
	callback: EventCallback<T>,
): Promise<UnlistenFn> {
	const off = await listen<T>(name, (event) => {
		off();
		callback(event);
	});
	return off;
}
export async function emit<T>(name: string, payload: T): Promise<void> {
	bus.dispatchEvent(new CustomEvent(name, { detail: payload }));
}
