import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyError } from "@/lib/core/notify";
import { loadVaultTree } from "@/lib/vault";
import { refreshTree, vaultStore } from "@/lib/vault/store";

vi.mock("@/lib/core/tauri", () => ({
	isTauri: () => false,
	isMacOS: () => false,
	isMobileApp: () => false,
	getPlatformOS: () => "other",
}));

vi.mock("@/lib/core/notify", () => ({
	notifyError: vi.fn(),
}));

vi.mock("@/lib/vault", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/vault")>();
	return { ...actual, loadVaultTree: vi.fn() };
});

describe("refreshTree busy reset", () => {
	beforeEach(() => {
		vaultStore.setState({
			vaultPath: null,
			busy: false,
			treeLoading: false,
		});
		vi.mocked(loadVaultTree).mockReset();
		vi.mocked(notifyError).mockClear();
	});

	it("resets busy when the vault path is invalidated mid-load", async () => {
		// Startup race: validateRestoredVault clears the restored path while
		// the first tree load is still in flight. Stuck busy:true here
		// disabled every button on the welcome page.
		vaultStore.setState({ vaultPath: "/vault/gone" });
		vi.mocked(loadVaultTree).mockImplementation(async () => {
			vaultStore.setState({ vaultPath: null });
			throw new Error("vault path is not a directory");
		});

		await refreshTree("/vault/gone");

		const s = vaultStore.getState();
		expect(s.busy).toBe(false);
		expect(s.treeLoading).toBe(false);
		// The invalidated-root diagnosis belongs to validateRestoredVault.
		expect(notifyError).not.toHaveBeenCalled();
	});

	it("resets busy and toasts on an ordinary load failure", async () => {
		vaultStore.setState({ vaultPath: "/vault/a" });
		vi.mocked(loadVaultTree).mockRejectedValue(new Error("permission denied"));

		await refreshTree("/vault/a");

		const s = vaultStore.getState();
		expect(s.busy).toBe(false);
		expect(s.treeLoading).toBe(false);
		expect(notifyError).toHaveBeenCalledTimes(1);
	});

	it("applies the loaded tree on success", async () => {
		vaultStore.setState({ vaultPath: "/vault/a" });
		const nodes = [
			{ id: "n1", name: "n1", path: "/vault/a/n1", kind: "file" },
		] as never;
		vi.mocked(loadVaultTree).mockResolvedValue(nodes);

		await refreshTree("/vault/a");

		const s = vaultStore.getState();
		expect(s.tree).toEqual(nodes);
		expect(s.busy).toBe(false);
		expect(s.treeLoading).toBe(false);
	});
});
