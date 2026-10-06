import { errorText } from "@/lib/core/error";
import { logger } from "@/lib/core/logger";
import type {
	FactLifecycleEvent,
	LifecycleEvent,
	LifecycleEventMap,
	ScopedLifecycleEvent,
} from "@/lib/lifecycle/events";

export type Teardown = () => void;

type ScopedHandler<E extends ScopedLifecycleEvent> = (
	payload: LifecycleEventMap[E],
) => Teardown | void | Promise<Teardown> | Promise<void>;

type FactHandler<E extends FactLifecycleEvent> = (
	payload: LifecycleEventMap[E],
) => void | Promise<void>;

/**
 * One `on()` call. Identity lives on the record rather than the handler so the
 * same function registered twice disposes and tears down independently.
 */
type Registration = {
	run: (payload: unknown) => unknown;
	teardown: Teardown | null;
	disposed: boolean;
};

const registrations = new Map<LifecycleEvent, Registration[]>();

/**
 * Serializes scoped setup/teardown per event. Setup is async, so without this a
 * fast switch could tear down the new scope or leak the old one: the emitter
 * releases scope A synchronously while A's handlers are still running, and B's
 * setup would otherwise race it.
 */
const scopeChains = new Map<ScopedLifecycleEvent, Promise<void>>();

function enqueueScoped(
	event: ScopedLifecycleEvent,
	task: () => Promise<void>,
): void {
	const prev = scopeChains.get(event) ?? Promise.resolve();
	const next = prev.then(task, task).catch(() => undefined);
	scopeChains.set(event, next);
}

function runTeardown(event: LifecycleEvent, record: Registration): void {
	const teardown = record.teardown;
	record.teardown = null;
	if (!teardown) return;
	try {
		teardown();
	} catch (e) {
		logger.error(`lifecycle teardown failed event=${event}`, {
			error: errorText(e),
		});
	}
}

export function on<E extends ScopedLifecycleEvent>(
	event: E,
	handler: ScopedHandler<E>,
): () => void;
export function on<E extends FactLifecycleEvent>(
	event: E,
	handler: FactHandler<E>,
): () => void;
export function on(
	event: LifecycleEvent,
	handler: (payload: never) => unknown,
): () => void {
	const record: Registration = {
		run: handler as (payload: unknown) => unknown,
		teardown: null,
		disposed: false,
	};
	const list = registrations.get(event) ?? [];
	list.push(record);
	registrations.set(event, list);
	return () => {
		if (record.disposed) return;
		record.disposed = true;
		const current = registrations.get(event);
		const idx = current?.indexOf(record) ?? -1;
		if (current && idx >= 0) current.splice(idx, 1);
		runTeardown(event, record);
	};
}

/** Handlers run serially in registration order; ordering constraints are
 *  expressed by registration order, not priorities. */
export async function emit<E extends FactLifecycleEvent>(
	event: E,
	payload: LifecycleEventMap[E],
): Promise<void> {
	for (const record of [...(registrations.get(event) ?? [])]) {
		if (record.disposed) continue;
		try {
			await record.run(payload);
		} catch (e) {
			logger.error(`lifecycle handler failed event=${event}`, {
				error: errorText(e),
			});
		}
	}
}

/**
 * Open a scope: run handlers in registration order and return the release
 * function, which tears their cleanups down in reverse order.
 *
 * Returns synchronously so callers can hand it straight to a React effect
 * cleanup. Release is queued on the same chain as setup, so calling it before
 * setup finishes still tears down in the right order. Idempotent.
 */
export function emitScoped<E extends ScopedLifecycleEvent>(
	event: E,
	payload: LifecycleEventMap[E],
): Teardown {
	const scope: Registration[] = [];
	let released = false;
	enqueueScoped(event, async () => {
		// Released before setup got a turn (StrictMode mount/unmount): nobody
		// holds this scope, so skip the work instead of undoing it.
		if (released) return;
		for (const record of [...(registrations.get(event) ?? [])]) {
			if (record.disposed) continue;
			let result: unknown;
			try {
				result = await record.run(payload);
			} catch (e) {
				logger.error(`lifecycle handler failed event=${event}`, {
					error: errorText(e),
				});
				continue;
			}
			if (typeof result !== "function") continue;
			const teardown = result as Teardown;
			// Released or disposed while this handler was running: undo it now,
			// since nothing will come back for it later.
			if (released || record.disposed) {
				record.teardown = teardown;
				runTeardown(event, record);
				continue;
			}
			record.teardown = teardown;
			scope.push(record);
		}
	});
	return () => {
		if (released) return;
		released = true;
		enqueueScoped(event, async () => {
			for (const record of [...scope].reverse()) runTeardown(event, record);
			scope.length = 0;
		});
	};
}
