import { describe, expect, it, vi } from "vitest";
import {
	notifyWikiEmbedTargets,
	subscribeWikiEmbedTarget,
} from "@/lib/wiki/embed-refresh";

describe("wiki embed target refresh", () => {
	it("notifies only embeds resolved to the changed target", () => {
		const onA = vi.fn();
		const onB = vi.fn();
		const unsubscribeA = subscribeWikiEmbedTarget("/vault/notes/A.md", onA);
		const unsubscribeB = subscribeWikiEmbedTarget("/vault/notes/B.md", onB);

		notifyWikiEmbedTargets(["/vault/notes/A.md"]);

		expect(onA).toHaveBeenCalledTimes(1);
		expect(onB).not.toHaveBeenCalled();
		unsubscribeA();
		unsubscribeB();
	});

	it("normalizes watcher path separators and casing", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeWikiEmbedTarget(
			"/Vault/Notes/Target.md",
			listener,
		);

		notifyWikiEmbedTargets(["\\vault\\notes\\target.MD"]);

		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it("stops notifying an embed after it unsubscribes", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeWikiEmbedTarget(
			"/vault/notes/Target.md",
			listener,
		);
		unsubscribe();

		notifyWikiEmbedTargets(["/vault/notes/Target.md"]);

		expect(listener).not.toHaveBeenCalled();
	});
});
