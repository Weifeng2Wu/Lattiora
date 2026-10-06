/** Shared, data-only parsing. Pasted npx commands are never executed. */
export type SkillSource = {
	owner: string;
	repo: string;
	ref: string | null;
	path: string;
	names: string[];
	url: string;
};
export function validSkillName(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
}
export function validSkillPath(path: string): boolean {
	return (
		path.length <= 1024 &&
		!path.includes("\\") &&
		![...path].some((char) => char.charCodeAt(0) < 32) &&
		path
			.split("/")
			.every((part) => part && part !== "." && part !== ".." && part !== ".git")
	);
}
export function parseSkillSource(input: string): SkillSource | null {
	let raw = input.trim();
	let shorthand = false;
	const names: string[] = [];
	if (/^npx\s+skills\s+add\b/.test(raw)) {
		const tokens: string[] = [];
		const tokenizer =
			/\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s"']+))/gy;
		let offset = 0;
		while (offset < raw.length) {
			tokenizer.lastIndex = offset;
			const match = tokenizer.exec(raw);
			if (!match) throw new Error("invalidSkillSource");
			tokens.push(match[1] ?? match[2] ?? match[3]);
			offset = tokenizer.lastIndex;
		}
		if (tokens.length < 4) throw new Error("invalidSkillSource");
		raw = tokens[3];
		shorthand = true;
		for (let i = 4; i < tokens.length; i++) {
			if (tokens[i] === "--skill") {
				let found = false;
				while (tokens[i + 1] && !tokens[i + 1].startsWith("-")) {
					names.push(tokens[++i]);
					found = true;
				}
				if (!found) throw new Error("invalidSkillSource");
			} else if (tokens[i] !== "-y" && tokens[i] !== "--yes")
				throw new Error("invalidSkillSource");
		}
	}
	if (raw.startsWith("github:")) {
		raw = `https://github.com/${raw.slice(7)}`;
		shorthand = true;
	}
	if (shorthand && !raw.includes("://")) raw = `https://github.com/${raw}`;
	// URL normalizes dot segments before pathname is observable. Reject them first.
	if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(raw))
		throw new Error("invalidSkillSource");
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		if (shorthand) throw new Error("invalidSkillSource");
		return null;
	}
	if (
		!["github.com", "skills.sh", "www.github.com", "www.skills.sh"].includes(
			url.hostname,
		)
	) {
		if (shorthand) throw new Error("invalidSkillSource");
		return null;
	}
	if (
		!/^https?:$/.test(url.protocol) ||
		url.username ||
		url.password ||
		url.port ||
		url.search
	)
		throw new Error("invalidSkillSource");
	let parts: string[];
	try {
		parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
	} catch {
		throw new Error("invalidSkillSource");
	}
	const owner = parts[0] ?? "";
	const repo = (parts[1] ?? "").replace(/\.git$/, "");
	if (
		!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(owner) ||
		!/^[\w.-]{1,100}$/.test(repo) ||
		repo === "." ||
		repo === ".."
	)
		throw new Error("invalidSkillSource");
	let ref: string | null = null;
	try {
		ref = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
	} catch {
		throw new Error("invalidSkillSource");
	}
	let path = "";
	if (url.hostname.endsWith("skills.sh")) {
		if (parts.length !== 3) throw new Error("invalidSkillSource");
		names.push(parts[2]);
	} else if (parts.length > 2) {
		if (!["tree", "blob"].includes(parts[2]) || parts.length < 4)
			throw new Error("invalidSkillSource");
		ref ??= parts[3];
		path = parts.slice(4).join("/");
		if (parts[2] === "blob") {
			if (path.split("/").at(-1) !== "SKILL.md")
				throw new Error("invalidSkillSource");
			path = path.slice(0, -"SKILL.md".length).replace(/\/$/, "");
		}
	}
	if (
		(ref &&
			(ref.length > 256 ||
				ref.includes("\\") ||
				[...ref].some((char) => char.charCodeAt(0) <= 32) ||
				ref.includes(".."))) ||
		(path && !validSkillPath(path)) ||
		names.some((name) => name !== "*" && !validSkillName(name))
	)
		throw new Error("invalidSkillSource");
	return {
		owner,
		repo,
		ref,
		path,
		names: names.includes("*") ? [] : [...new Set(names)],
		url: `https://github.com/${owner}/${repo}`,
	};
}

/** The original importer accepts quoted and folded top-level YAML scalars. */
export function parseSkillMetadata(body: string): {
	name: string;
	description: string;
} {
	const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1];
	if (!header || header.length > 64 * 1024)
		throw new Error("invalidSkillMetadata");
	const lines = header.replace(/\r/g, "").split("\n");
	const scalar = (key: string) => {
		const index = lines.findIndex((line) => line.startsWith(`${key}:`));
		if (index < 0) return "";
		let value = lines[index].slice(key.length + 1).trim();
		const more: string[] = [];
		for (
			let i = index + 1;
			i < lines.length && (!lines[i].trim() || /^[ \t]/.test(lines[i]));
			i++
		)
			more.push(lines[i].trim());
		if (/^[>|][+-]?(?:\s+#.*)?$/.test(value)) value = more.join(" ");
		else if (value.startsWith('"')) {
			try {
				const quoted = /^"(?:[^"\\]|\\.)*"/.exec(value)?.[0];
				if (!quoted || !/^(?:\s+#.*)?$/.test(value.slice(quoted.length)))
					throw new Error("invalidSkillMetadata");
				value = JSON.parse(quoted);
			} catch {
				throw new Error("invalidSkillMetadata");
			}
		} else if (value.startsWith("'")) {
			const match = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(value);
			if (!match) throw new Error("invalidSkillMetadata");
			value = match[1].replace(/''/g, "'");
		} else value = [value.replace(/\s+#.*$/, ""), ...more].join(" ");
		return value.replace(/\s+/g, " ").trim();
	};
	const name = scalar("name");
	const description = [...scalar("description")].slice(0, 1024).join("");
	if (!validSkillName(name) || !description)
		throw new Error("invalidSkillMetadata");
	return { name, description };
}
