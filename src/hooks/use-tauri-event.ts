import { useEffect, useRef } from "react";
import {
	listenEventSafe,
	type TauriEventHandler,
	type TypedEventBinding,
} from "@/lib/core/tauri-events";

/**
 * Subscribe to a typed specta event binding (`events.*`) for the lifetime of
 * the component.
 *
 * The handler is held in a ref, so an inline closure does not resubscribe on
 * every render — only a changed `event` binding does.
 */
export function useTauriEvent<T>(
	event: TypedEventBinding<T>,
	handler: TauriEventHandler<T>,
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;
	useEffect(
		() => listenEventSafe(event, (payload) => handlerRef.current(payload)),
		[event],
	);
}
