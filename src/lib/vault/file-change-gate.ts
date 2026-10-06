/**
 * Activity-gated `vault:file-changed` subscription.
 *
 * While the shell is hidden or unfocused, payloads are buffered. Returning to
 * the foreground flushes them in order so tree / editor / wiki work does not
 * run against an invisible window.
 */

import { events } from "@/lib/core/bindings";
import { listenEventSafe } from "@/lib/core/tauri-events";
import type { VaultFileChangedPayload } from "@/lib/vault/fs-watch";
import {
	isShellActive,
	subscribeShellActivity,
} from "@/lib/vault/shell-activity";

export type VaultFileChangedHandler = (
	payload: VaultFileChangedPayload,
) => void | Promise<void>;

/**
 * Listen for Host vault file changes, buffering while the shell is inactive.
 * The disposer drops any still-buffered payloads.
 */
export function listenVaultFileChangedGated(
	handler: VaultFileChangedHandler,
): () => void {
	const buffer: VaultFileChangedPayload[] = [];
	let flushing = false;
	let disposed = false;

	const deliver = async (payload: VaultFileChangedPayload) => {
		await handler(payload);
	};

	const flush = () => {
		if (disposed || flushing) return;
		if (!isShellActive() || buffer.length === 0) return;
		flushing = true;
		void (async () => {
			try {
				while (!disposed && buffer.length > 0 && isShellActive()) {
					const next = buffer.shift();
					if (!next) break;
					await deliver(next);
				}
			} finally {
				flushing = false;
				if (!disposed && buffer.length > 0 && isShellActive()) flush();
			}
		})();
	};

	const unlisten = listenEventSafe(events.vaultFileChanged, (payload) => {
		if (disposed) return;
		if (!isShellActive() || buffer.length > 0 || flushing) {
			buffer.push(payload);
			if (isShellActive()) flush();
			return;
		}
		void deliver(payload);
	});

	const unsubActivity = subscribeShellActivity((active) => {
		if (active) flush();
	});

	return () => {
		disposed = true;
		buffer.length = 0;
		unlisten();
		unsubActivity();
	};
}
