import { afterEach, describe, expect, it } from "vitest";
import {
	backgroundTasksStore,
	cancelBackgroundTask,
	isBackgroundTaskCancelledError,
} from "@/lib/core/background-tasks";

const globalWithWindow = globalThis as typeof globalThis & {
	window?: { setTimeout: typeof setTimeout };
};
globalWithWindow.window = { setTimeout };

import { runLocalActivity } from "@/lib/core/tasks";

function row(id: string) {
	return backgroundTasksStore.getState().tasks.find((task) => task.id === id);
}

describe("runLocalActivity facade", () => {
	afterEach(() => {
		backgroundTasksStore.setState({ tasks: [], expanded: false });
	});

	it("runs the activity and completes its panel row", async () => {
		let taskId = "";
		const result = await runLocalActivity(
			{ kind: "paperRead", title: "read", detail: "papers/x" },
			async ({ setProgress, setDetail }) => {
				setDetail("working");
				setProgress(50);
				return 42;
			},
			{ onTaskId: (id) => (taskId = id) },
		);

		expect(result).toBe(42);
		expect(row(taskId)).toMatchObject({
			kind: "paperRead",
			title: "read",
			status: "completed",
			progress: 100,
		});
	});

	it("cancels an import through the original task panel", async () => {
		let taskId = "";
		const run = runLocalActivity(
			{ kind: "import", title: "import" },
			({ signal }) =>
				new Promise<string>((_resolve, reject) => {
					signal.addEventListener("abort", () =>
						reject(new Error("AbortError")),
					);
				}),
			{ onTaskId: (id) => (taskId = id) },
		);
		cancelBackgroundTask(taskId);

		await expect(run).rejects.toSatisfy(isBackgroundTaskCancelledError);
		expect(row(taskId)?.status).toBe("cancelled");
	});

	it("fails the row and rethrows when the activity throws", async () => {
		let taskId = "";
		const run = runLocalActivity(
			{ kind: "layoutRun", title: "boom" },
			async () => {
				throw new Error("nope");
			},
			{ onTaskId: (id) => (taskId = id) },
		);

		await expect(run).rejects.toThrow("nope");
		expect(row(taskId)).toMatchObject({ status: "failed", error: "nope" });
	});
});
