import { describe, expect, it } from "vitest";
import { splitVaultRel } from "@/lib/vault/fs";
import { parseRemoteJoinedPath } from "@/lib/vault/remote/remote-vault";

describe("splitVaultRel", () => {
	it("returns null for empty / root rel", () => {
		expect(splitVaultRel("")).toBeNull();
		expect(splitVaultRel("/")).toBeNull();
		expect(splitVaultRel("///")).toBeNull();
	});

	it("splits single-segment and nested paths", () => {
		expect(splitVaultRel("notes")).toEqual({ parent: "", name: "notes" });
		expect(splitVaultRel("notes/todo.md")).toEqual({
			parent: "notes",
			name: "todo.md",
		});
		expect(splitVaultRel("papers/a/b")).toEqual({
			parent: "papers/a",
			name: "b",
		});
	});

	it("normalizes slashes and trailing separators", () => {
		expect(splitVaultRel("notes\\draft\\")).toEqual({
			parent: "notes",
			name: "draft",
		});
		expect(splitVaultRel("/notes/x/")).toEqual({
			parent: "notes",
			name: "x",
		});
	});
});

describe("parseRemoteJoinedPath + splitVaultRel (create preflight)", () => {
	it("derives parent list target for a remote create path", () => {
		const full = "remote:sess-1/notes/New Folder";
		const remote = parseRemoteJoinedPath(full);
		expect(remote).toEqual({
			sessionId: "sess-1",
			rel: "notes/New Folder",
		});
		if (!remote) throw new Error("Expected a remote path");
		expect(splitVaultRel(remote.rel)).toEqual({
			parent: "notes",
			name: "New Folder",
		});
	});

	it("lists vault root when creating at remote root", () => {
		const full = "remote:sess-1/scratch";
		const remote = parseRemoteJoinedPath(full);
		expect(remote).toEqual({ sessionId: "sess-1", rel: "scratch" });
		if (!remote) throw new Error("Expected a remote path");
		expect(splitVaultRel(remote.rel)).toEqual({
			parent: "",
			name: "scratch",
		});
	});
});
