import { describe, expect, it } from "vitest";
import { buildNoteShare, prepareNoteShare } from "../src/lib/cloud/note-share";

const documents = [
	{
		path: "notes/A.md",
		content:
			"---\nprivate: hidden-a\n---\n# Note A\n\nA included body. [[Source|Back]] [[Secret]]",
	},
	{ path: "notes/B.md", content: "# Note B\n\nB excluded body." },
	{
		path: "notes/Secret.md",
		content: "# Secret\n\nNever publish this indirect note.",
	},
];
const root =
	"---\nprivate: hidden-root\n---\n# Source\n\n[[A|Read A]] and [Read B](B.md). `[[Secret]]`\n\n```md\n[[Secret]]\n```";

describe("explicit linked note sharing", () => {
	it("publishes only the root by default and never discovers links inside code", async () => {
		const draft = await prepareNoteShare(
			"/cloud/notes/Source.md",
			root,
			documents,
		);
		expect(draft.linkedNotes.map((note) => note.path)).toEqual([
			"notes/A.md",
			"notes/B.md",
		]);
		const text = await (await buildNoteShare(draft, [])).text();
		const snapshot = JSON.parse(text);
		expect(snapshot.notes).toHaveLength(1);
		expect(snapshot.notes[0].markdown).toContain("Read A and Read B");
		expect(snapshot.notes[0].markdown).toContain("`[[Secret]]`");
		expect(text).not.toMatch(
			/hidden-root|included body|excluded body|indirect note|#note=/,
		);
	});
	it("includes selected snapshots, preserves aliases and bounds cycles without publishing further links", async () => {
		const draft = await prepareNoteShare("notes/Source.md", root, documents);
		const snapshot = JSON.parse(
			await (await buildNoteShare(draft, ["notes/A.md"])).text(),
		);
		expect(snapshot.notes).toHaveLength(2);
		expect(snapshot.notes[0].markdown).toContain("[Read A](#note=1)");
		expect(snapshot.notes[1].markdown).toContain("[Back](#note=0)");
		expect(snapshot.notes[1].markdown).toContain("A included body");
		expect(JSON.stringify(snapshot)).not.toMatch(
			/hidden-a|hidden-root|B excluded|Never publish/,
		);
		await expect(buildNoteShare(draft, ["notes/Secret.md"])).rejects.toThrow(
			"invalidShare",
		);
	});
});
