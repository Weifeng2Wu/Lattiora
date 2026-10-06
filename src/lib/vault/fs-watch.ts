import type { VaultFileChangedEvent } from "@/lib/core/bindings";

/**
 * Payload of the `vault:file-changed` event emitted by the Host watcher.
 * Wire shape from the generated bindings; subscribe via `events.vaultFileChanged`.
 */
export type VaultFileChangedPayload = VaultFileChangedEvent;

/** Start (or restart) watching the given Vault directory for this window. */
export async function startVaultWatch(_vaultPath: string): Promise<void> {
	return;
}

/** Stop watching the Vault for this window. */
export async function stopVaultWatch(): Promise<void> {
	return;
}
