/** Original opt-in GitHub download mirrors; never used for API requests or credentials. */
export const GITHUB_MIRROR_PRESETS = [
	"https://gh.llkk.cc",
	"https://mirror.ghproxy.com",
	"https://ghproxy.net",
	"https://github.moeyy.xyz",
] as const;

export function mirroredGithubDownload(url: string, mirror?: string): string {
	if (!mirror) return url;
	if (!(GITHUB_MIRROR_PRESETS as readonly string[]).includes(mirror))
		throw new Error("invalidEndpoint");
	const source = new URL(url);
	if (source.origin !== "https://raw.githubusercontent.com") return url;
	const [owner, repo, ref, ...path] = source.pathname.slice(1).split("/");
	return `${mirror}/https://github.com/${owner}/${repo}/raw/${ref}/${path.join("/")}`;
}
