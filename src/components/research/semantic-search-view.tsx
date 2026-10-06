import { ArrowUpRight, Database, Search, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cloudAiError } from "@/lib/cloud/ai";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import {
	buildSemanticIndex,
	type SemanticHit,
	searchSemantic,
	semanticIndexStatus,
} from "@/lib/cloud/semantic-search";
import { notifyError } from "@/lib/core/notify";
import { openSettingsWindow } from "@/lib/shell/settings-window";
import { openCitation } from "@/lib/workspace/actions";

export function SemanticSearchView({
	onOpenFile,
}: {
	onOpenFile?: (path: string) => void;
}) {
	const { t } = useTranslation(["app", "cloud"]);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SemanticHit[]>([]);
	const [searched, setSearched] = useState(false);
	const [busy, setBusy] = useState<"index" | "search" | null>(null);
	const [progress, setProgress] = useState({ done: 0, total: 0, path: "" });
	const [status, setStatus] = useState({
		total: 0,
		indexed: 0,
		partial: 0,
		chunks: 0,
	});
	const [failures, setFailures] = useState<
		Array<{ path: string; error: string }>
	>([]);
	const controller = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const refresh = useCallback(async () => {
		try {
			const value = await semanticIndexStatus();
			if (mounted.current) setStatus(value);
		} catch {
			if (mounted.current) notifyError(t("research.semantic-search.failed"));
		}
	}, [t]);
	useEffect(() => {
		mounted.current = true;
		void refresh();
		let timer: ReturnType<typeof setTimeout>;
		const unsubscribe = subscribeCloudFiles((paths) => {
			if (paths.every((path) => path.startsWith(".agentero/recommend/")))
				return;
			clearTimeout(timer);
			timer = setTimeout(() => void refresh(), 500);
			// Search results refer to a specific saved source, never keep them after edits.
			setHits([]);
			setSearched(false);
		});
		return () => {
			mounted.current = false;
			controller.current?.abort();
			clearTimeout(timer);
			unsubscribe();
		};
	}, [refresh]);
	const run = async (kind: "index" | "search") => {
		if (controller.current) return;
		const abort = new AbortController();
		controller.current = abort;
		setBusy(kind);
		try {
			if (kind === "index") {
				setFailures([]);
				const errors = await buildSemanticIndex(
					abort.signal,
					(done, total, path) => {
						if (mounted.current) setProgress({ done, total, path });
					},
				);
				if (mounted.current) setFailures(errors);
			} else {
				const result = await searchSemantic(query, abort.signal);
				if (mounted.current) {
					setHits(result);
					setSearched(true);
				}
			}
		} catch (error) {
			if (!abort.signal.aborted)
				notifyError(
					error instanceof Error && error.message === "semanticIndexMissing"
						? t("research.semantic-search.buildFirst")
						: cloudAiError(error),
				);
		} finally {
			controller.current = null;
			if (mounted.current) {
				setBusy(null);
				void refresh();
			}
		}
	};
	const open = (hit: SemanticHit) => {
		const path = hit.path.replace(/\/marks\/[^/]+\.json$/, "");
		const target = hit.page ? `${path}#page=${hit.page}` : path;
		if (onOpenFile) onOpenFile(target);
		else openCitation(target);
	};
	return (
		<section
			className="h-full overflow-auto bg-background"
			aria-label={t("research.semantic-search.title")}
		>
			<div className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8">
				<div className="flex items-center justify-between gap-3">
					<h1 className="text-xl font-semibold">
						{t("research.semantic-search.title")}
					</h1>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("research.semantic-search.settings")}
						title={t("research.semantic-search.settings")}
						onClick={() => openSettingsWindow("agent")}
					>
						<Settings2 />
					</Button>
				</div>
				<form
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void run("search");
					}}
				>
					<Input
						value={query}
						maxLength={2000}
						onChange={(event) => setQuery(event.target.value)}
						aria-label={t("research.semantic-search.query")}
						placeholder={t("research.semantic-search.query")}
					/>
					<Button
						type="submit"
						disabled={!!busy || !query.trim()}
						aria-label={t("research.semantic-search.search")}
					>
						<Search className="size-4" />
					</Button>
				</form>
				<div className="space-y-3 rounded-xl border bg-muted/20 p-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-sm text-muted-foreground" role="status">
							{t("research.semantic-search.coverage", status)}
						</p>
						<Button
							variant="secondary"
							size="sm"
							disabled={!!busy}
							onClick={() => void run("index")}
						>
							<Database className="size-4" />
							{t("research.semantic-search.index")}
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{t("research.semantic-search.hint")}
					</p>
					{!!status.partial && (
						<p className="text-xs text-muted-foreground">
							{t("research.semantic-search.partial", { count: status.partial })}
						</p>
					)}
					{busy && (
						<div className="flex items-center gap-3">
							<div className="min-w-0 flex-1">
								<progress
									className="w-full accent-primary"
									aria-label={t("research.semantic-search.indexing")}
									max={Math.max(1, progress.total)}
									value={busy === "index" ? progress.done : undefined}
								/>
								<p className="truncate text-xs text-muted-foreground">
									{busy === "index"
										? progress.path
										: t("research.semantic-search.searching")}
								</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("research.cancel")}
								onClick={() => controller.current?.abort()}
							>
								<X />
							</Button>
						</div>
					)}
					{!!failures.length && (
						<details>
							<summary className="text-xs">
								{t("research.semantic-search.failures", {
									count: failures.length,
								})}
							</summary>
							<ul className="mt-2 space-y-1 text-xs text-muted-foreground">
								{failures.map((failure) => (
									<li key={failure.path} className="break-words">
										{failure.path}: {cloudAiError(new Error(failure.error))}
									</li>
								))}
							</ul>
						</details>
					)}
				</div>
				<ul className="space-y-3">
					{hits.map((hit) => (
						<li key={hit.id}>
							<button
								type="button"
								className="w-full rounded-xl border p-4 text-left hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring"
								onClick={() => open(hit)}
							>
								<div className="mb-2 flex items-center gap-3 text-sm font-medium">
									<span className="min-w-0 flex-1 truncate">{hit.path}</span>
									<ArrowUpRight className="size-4 shrink-0" />
								</div>
								<p className="line-clamp-5 whitespace-pre-wrap break-words text-sm text-muted-foreground">
									{hit.text}
								</p>
								<p className="mt-2 text-xs text-muted-foreground">
									{hit.page
										? t("research.semantic-search.page", { page: hit.page })
										: t("research.semantic-search.line", { line: hit.line })}
								</p>
							</button>
						</li>
					))}
				</ul>
				{searched && !hits.length && (
					<p className="py-10 text-center text-sm text-muted-foreground">
						{t("research.semantic-search.empty")}
					</p>
				)}
			</div>
		</section>
	);
}
