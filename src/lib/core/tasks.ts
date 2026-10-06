import i18n from "@/i18n";
/** Browser task-panel activities with progress, bounded concurrency and cancellation. */

import {
	BackgroundTaskCancelledError,
	cancelBackgroundTask,
	completeBackgroundTask,
	failBackgroundTask,
	getBackgroundTasksSnapshot,
	isBackgroundTaskCancelledError,
	type LocalActivityKind,
	registerBackgroundTaskCancelHandler,
	releaseBackgroundTaskCancelHandler,
	startBackgroundTask,
	updateBackgroundTask,
} from "@/lib/core/background-tasks";
import { errorText } from "@/lib/core/error";
import { logger } from "@/lib/core/logger";

export type LocalActivityInput = {
	kind: LocalActivityKind;
	title: string;
	detail?: string;
};

export type LocalActivityContext = {
	id: string;
	signal: AbortSignal;
	setProgress: (n: number | null) => void;
	setDetail: (d: string) => void;
};

export type LocalActivityOptions = {
	/** Same-kind frontend semaphore cap; without it the activity starts now. */
	concurrency?: number;
	/** Fires synchronously with the panel-row id before any queueing. */
	onTaskId?: (id: string) => void;
};

class Semaphore {
	private running = 0;
	private queue: Array<() => void> = [];

	constructor(private max: number) {}

	setMax(max: number): void {
		this.max = Math.max(1, Math.floor(max));
		this.drain();
	}

	private drain(): void {
		while (this.queue.length > 0 && this.running < this.max) {
			this.running++;
			this.queue.shift()?.();
		}
	}

	async acquire(): Promise<void> {
		if (this.running < this.max) {
			this.running++;
			return;
		}
		await new Promise<void>((resolve) => this.queue.push(resolve));
	}

	release(): void {
		this.running = Math.max(0, this.running - 1);
		this.drain();
	}
}

const semaphores = new Map<LocalActivityKind, Semaphore>();

function getSemaphore(kind: LocalActivityKind, concurrency: number): Semaphore {
	let sem = semaphores.get(kind);
	if (!sem) {
		sem = new Semaphore(concurrency);
		semaphores.set(kind, sem);
	} else {
		sem.setMax(concurrency);
	}
	return sem;
}

function isActivityCancelled(id: string, signal: AbortSignal): boolean {
	return (
		signal.aborted ||
		getBackgroundTasksSnapshot().tasks.find((t) => t.id === id)?.status ===
			"cancelled"
	);
}

/**
 * Local (non-Host) UI activity: panel row + AbortController runner.
 * Interactive, lifecycle-bound work that deliberately stays outside the
 * JobCenter (no dedupe / dependency / restart-recovery semantics).
 * Cancellation is purely local: the panel cancel aborts the controller.
 */
export async function runLocalActivity<T>(
	input: LocalActivityInput,
	fn: (ctx: LocalActivityContext) => Promise<T>,
	options?: LocalActivityOptions,
): Promise<T> {
	const concurrency = options?.concurrency;
	const id = startBackgroundTask({
		kind: input.kind,
		title: input.title,
		detail: input.detail,
		running: concurrency == null,
	});
	const controller = new AbortController();
	registerBackgroundTaskCancelHandler(id, () => controller.abort());
	options?.onTaskId?.(id);
	logger.info(
		`op enqueue local_activity kind=${input.kind} task_id=${id} title=${input.title} concurrency=${concurrency ?? "unlimited"}`,
	);
	const throwIfCancelled = (): void => {
		if (isActivityCancelled(id, controller.signal)) {
			throw new BackgroundTaskCancelledError();
		}
	};
	let acquired = false;
	try {
		throwIfCancelled();
		if (concurrency != null) {
			await getSemaphore(input.kind, concurrency).acquire();
			acquired = true;
		}
		throwIfCancelled();
		if (concurrency != null) {
			updateBackgroundTask(id, { status: "running" });
		}
		const result = await fn({
			id,
			signal: controller.signal,
			// Absolute: callers (e.g. layout analysis) publish overall document %.
			setProgress: (n) =>
				updateBackgroundTask(id, { progress: n }, { absoluteProgress: true }),
			setDetail: (d) => updateBackgroundTask(id, { detail: d }),
		});
		throwIfCancelled();
		completeBackgroundTask(id);
		return result;
	} catch (e) {
		if (
			isActivityCancelled(id, controller.signal) ||
			isBackgroundTaskCancelledError(e)
		) {
			if (
				getBackgroundTasksSnapshot().tasks.find((t) => t.id === id)?.status !==
				"cancelled"
			) {
				cancelBackgroundTask(id);
			}
			throw new BackgroundTaskCancelledError();
		}
		const code = errorText(e);
		const msg = i18n.t(`cloud:errors.${code}`, { defaultValue: code });
		failBackgroundTask(id, msg);
		throw e;
	} finally {
		if (acquired) {
			getSemaphore(input.kind, concurrency as number).release();
		}
		releaseBackgroundTaskCancelHandler(id);
	}
}
