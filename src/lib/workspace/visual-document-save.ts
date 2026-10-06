/** One writer per editor: every write uses the last acknowledged snapshot. */
export class VisualDocumentSave {
	private saved: string;
	private pending: string | null = null;
	private running: Promise<boolean> | null = null;
	private generation = 0;
	constructor(
		seed: string,
		private persist: (content: string, expected: string) => Promise<boolean>,
		private dirty: (value: boolean) => void,
	) {
		this.saved = seed;
	}
	get isDirty() {
		return this.pending !== null;
	}
	change(content: string) {
		this.pending = content;
		this.dirty(content !== this.saved || this.running !== null);
	}
	reset(seed: string) {
		this.generation++;
		this.saved = seed;
		this.pending = null;
		this.dirty(false);
	}
	flush(): Promise<boolean> {
		if (this.running) return this.running;
		const run = async () => {
			while (this.pending !== null) {
				const content = this.pending;
				const generation = this.generation;
				if (content !== this.saved) {
					const ok = await this.persist(content, this.saved).catch(() => false);
					if (generation !== this.generation) continue;
					if (!ok) {
						this.dirty(true);
						return false;
					}
					this.saved = content;
				}
				if (this.pending === content) this.pending = null;
				this.dirty(this.pending !== null);
			}
			return true;
		};
		this.running = run().finally(() => {
			this.running = null;
		});
		return this.running;
	}
}
