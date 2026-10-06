/**
 * Shared chip / mention-row icon (paper / folder / typed file).
 */
import { contextPathIcon } from "@/lib/agent/context-path-icon";

export function ContextPathIcon({
	path,
	directoryPaths,
	paperPaths,
}: {
	path: string;
	directoryPaths: ReadonlySet<string>;
	paperPaths: ReadonlySet<string>;
}) {
	const Icon = contextPathIcon(path, { directoryPaths, paperPaths });
	return (
		<Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
	);
}
