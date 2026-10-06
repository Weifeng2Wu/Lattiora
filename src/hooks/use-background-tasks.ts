import { useStore } from "zustand";
import { backgroundTasksStore } from "@/lib/core/background-tasks";

export function useBackgroundTasks() {
	return useStore(backgroundTasksStore);
}
