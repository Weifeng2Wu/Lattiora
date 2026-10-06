import { useEffect, useState } from "react";

/** A controller is claimed only after the complete shell precache succeeds. */
export function useOfflineReady(): boolean {
	const [ready, setReady] = useState(() =>
		Boolean(navigator.serviceWorker?.controller),
	);
	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;
		const changed = () => setReady(Boolean(navigator.serviceWorker.controller));
		navigator.serviceWorker.addEventListener("controllerchange", changed);
		changed();
		return () =>
			navigator.serviceWorker.removeEventListener("controllerchange", changed);
	}, []);
	return ready;
}
