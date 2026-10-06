import { describe, expect, it, vi } from "vitest";
import { installDockviewDropOverlayCleanup } from "@/lib/workspace/dockview-drop-overlay-cleanup";

class FakeElement extends EventTarget {
	className = "";
	readonly classList: {
		add: (name: string) => void;
		remove: (name: string) => void;
		contains: (name: string) => boolean;
	};
	readonly children: FakeElement[] = [];
	parentElement: FakeElement | null = null;

	constructor(
		public tagName: string,
		className?: string,
	) {
		super();
		if (className) this.className = className;
		this.classList = {
			add: (name: string) => {
				const set = new Set(this.className.split(/\s+/).filter(Boolean));
				set.add(name);
				this.className = [...set].join(" ");
			},
			remove: (name: string) => {
				const set = new Set(this.className.split(/\s+/).filter(Boolean));
				set.delete(name);
				this.className = [...set].join(" ");
			},
			contains: (name: string) =>
				this.className.split(/\s+/).filter(Boolean).includes(name),
		};
	}

	appendChild(child: FakeElement): FakeElement {
		this.children.push(child);
		child.parentElement = this;
		return child;
	}

	contains(node: Node | null): boolean {
		if (!(node instanceof FakeElement)) return false;
		let current: FakeElement | null = node;
		while (current) {
			if (current === this) return true;
			current = current.parentElement;
		}
		return false;
	}

	remove(): void {
		if (this.parentElement) {
			const idx = this.parentElement.children.indexOf(this);
			if (idx >= 0) this.parentElement.children.splice(idx, 1);
			this.parentElement = null;
		}
	}

	querySelectorAll(selector: string): FakeElement[] {
		const result: FakeElement[] = [];
		const selectors = selector.split(",").map((s) => s.trim());
		const walk = (el: FakeElement) => {
			for (const sel of selectors) {
				const className = sel.startsWith(".") ? sel.slice(1) : sel;
				if (el.classList.contains(className)) result.push(el);
			}
			for (const child of el.children) walk(child);
		};
		for (const child of this.children) walk(child);
		return result;
	}
}

function harness() {
	const ownerWindow = new EventTarget() as unknown as Window;
	const ownerDocument = {
		defaultView: ownerWindow,
		createElement: (tag: string) => new FakeElement(tag),
	} as unknown as Document;

	const root = new FakeElement(
		"div",
		"agentero-dockview",
	) as unknown as HTMLElement;
	Object.defineProperty(root, "ownerDocument", { value: ownerDocument });

	const container = new FakeElement(
		"div",
		"dv-drop-target",
	) as unknown as HTMLElement;
	const dropzone = new FakeElement(
		"div",
		"dv-drop-target-dropzone",
	) as unknown as HTMLElement;
	const anchorContainer = new FakeElement(
		"div",
		"dv-drop-target-container",
	) as unknown as HTMLElement;
	const anchor = new FakeElement(
		"div",
		"dv-drop-target-anchor",
	) as unknown as HTMLElement;
	const edge = new FakeElement(
		"div",
		"dv-drop-target-edge",
	) as unknown as HTMLElement;

	container.appendChild(dropzone as unknown as FakeElement);
	anchorContainer.appendChild(anchor as unknown as FakeElement);
	root.appendChild(container as unknown as FakeElement);
	root.appendChild(anchorContainer as unknown as FakeElement);
	root.appendChild(edge as unknown as FakeElement);

	const cleanup = installDockviewDropOverlayCleanup(root);

	return {
		root: root as unknown as FakeElement,
		container: container as unknown as FakeElement,
		dropzone: dropzone as unknown as FakeElement,
		anchorContainer: anchorContainer as unknown as FakeElement,
		anchor: anchor as unknown as FakeElement,
		edge: edge as unknown as FakeElement,
		ownerWindow,
		cleanup,
	};
}

class FakeDragEvent extends Event {
	constructor(public readonly relatedTarget: HTMLElement | null) {
		super("dragleave");
	}
}

function fakeDragEvent(relatedTarget: HTMLElement | null): DragEvent {
	return new FakeDragEvent(relatedTarget) as unknown as DragEvent;
}

function hasOverlays(h: ReturnType<typeof harness>): boolean {
	return (
		h.root.querySelectorAll(
			".dv-drop-target-dropzone, .dv-drop-target-container, .dv-drop-target-anchor, .dv-drop-target-edge",
		).length > 0 || h.root.querySelectorAll(".dv-drop-target").length > 0
	);
}

describe("Dockview drop overlay cleanup", () => {
	it("clears overlays on dragend", () => {
		const h = harness();
		expect(hasOverlays(h)).toBe(true);

		h.ownerWindow.dispatchEvent(new Event("dragend"));

		expect(hasOverlays(h)).toBe(false);
		h.cleanup.dispose();
	});

	it("clears overlays when drag leaves the workspace root", () => {
		const h = harness();
		const outside = new FakeElement("div") as unknown as HTMLElement;

		h.root.dispatchEvent(fakeDragEvent(outside));

		expect(hasOverlays(h)).toBe(false);
		h.cleanup.dispose();
	});

	it("keeps overlays when drag moves between children of the root", () => {
		const h = harness();
		const inside = new FakeElement("div") as unknown as HTMLElement;
		h.root.appendChild(inside as unknown as FakeElement);

		h.root.dispatchEvent(fakeDragEvent(inside));

		expect(hasOverlays(h)).toBe(true);
		h.cleanup.dispose();
	});

	it("clears overlays when drag leaves the window", () => {
		const h = harness();

		h.root.dispatchEvent(fakeDragEvent(null));

		expect(hasOverlays(h)).toBe(false);
		h.cleanup.dispose();
	});

	it("removes listeners and disposes idempotently", () => {
		const h = harness();
		const removeSpy = vi.spyOn(h.root, "removeEventListener");

		h.cleanup.dispose();
		h.cleanup.dispose();

		expect(removeSpy).toHaveBeenCalledTimes(1);
		h.ownerWindow.dispatchEvent(new Event("dragend"));
		expect(hasOverlays(h)).toBe(true);
	});
});
