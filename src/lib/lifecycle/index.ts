import { emit, emitScoped, on } from "@/lib/lifecycle/bus";

export type { Teardown } from "@/lib/lifecycle/bus";
export type { LifecycleEvent, LifecycleEventMap } from "@/lib/lifecycle/events";
export { initLifecycleBridge } from "@/lib/lifecycle/tauri-bridge";

export const lifecycle = { on, emit, emitScoped };
