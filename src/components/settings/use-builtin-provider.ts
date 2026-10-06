import { useEffect, useState } from "react";
import { loadBuiltinProviderStatus } from "@/lib/core/builtin";

/**
 * Whether the built-in ("agentero") provider is compiled into this build.
 * Backed by a module-level cache, so every settings pane shares one IPC.
 *
 * Renders only: it starts `false` and settles asynchronously, so anything that
 * *writes* a provider id must await `loadBuiltinProviderStatus()` directly
 * instead of reading this.
 */
export function useBuiltinProviderAvailable(): boolean {
	const [available, setAvailable] = useState(false);
	useEffect(() => {
		let active = true;
		const refresh = () => {
			void loadBuiltinProviderStatus().then((status) => {
				if (active) setAvailable(status?.available ?? false);
			});
		};
		refresh();
		window.addEventListener("cloud:ai-config", refresh);
		return () => {
			active = false;
			window.removeEventListener("cloud:ai-config", refresh);
		};
	}, []);
	return available;
}
