import { events } from "@/lib/core/bindings";
import type { UnlistenFn } from "@/lib/core/browser-events";
import type { TypedEventBinding } from "@/lib/core/tauri-events";
import { emit } from "@/lib/lifecycle/bus";
import type {
	FactLifecycleEvent,
	LifecycleEventMap,
} from "@/lib/lifecycle/events";

/**
 * Forward one typed wire event into the frontend lifecycle bus. The bus
 * contract (`LifecycleEventMap`) predates the specta bindings and some wire
 * payloads supersede it (e.g. `job:completed` carries the full terminal
 * snapshot), so the payload crosses the boundary with a cast — the same
 * unchecked handoff the previous string-based `listen<T>` performed.
 */
function forward<E extends FactLifecycleEvent>(
	wire: TypedEventBinding<unknown>,
	event: E,
): Promise<UnlistenFn> {
	return wire.listen((e) => {
		void emit(event, e.payload as LifecycleEventMap[E]);
	});
}

function wireSubscriptions(): Array<Promise<UnlistenFn>> {
	return [
		forward(events.windowClosed, "window:closed"),
		forward(events.paperImported, "paper:imported"),
		forward(events.paperAssetsReady, "paper:assets-ready"),
		forward(events.paperRenamed, "paper:renamed"),
		forward(events.jobCompleted, "job:completed"),
		forward(events.jobFailed, "job:failed"),
		forward(events.agentRegistryChanged, "agent:registry-changed"),
	];
}

let bridgePromise: Promise<Array<() => void>> | null = null;
let consumers = 0;

/** Forwards Tauri wire lifecycle events into the frontend bus. Idempotent;
 *  the returned disposer waits for pending `listen` calls before unlistening. */
export function initLifecycleBridge(): () => void {
	consumers += 1;
	if (!bridgePromise) {
		bridgePromise = Promise.all(wireSubscriptions());
	}
	const pending = bridgePromise;
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		consumers -= 1;
		void pending.then((unlistens) => {
			if (consumers > 0 || bridgePromise !== pending) return;
			bridgePromise = null;
			for (const unlisten of unlistens) unlisten();
		});
	};
}
