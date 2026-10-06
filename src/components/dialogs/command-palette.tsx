import {
	FileText,
	Loader2,
	type LucideIcon,
	Settings2,
	SquareTerminal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Command,
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { cloudAiError } from "@/lib/cloud/ai";
import { notifyError } from "@/lib/core/notify";
import type { PaperMetadata } from "@/lib/paper";
import { filterByFuzzy } from "@/lib/shell/commands/match";
import type { AppCommand, PaletteMode } from "@/lib/shell/commands/types";
import { type SearchHit, searchVault } from "@/lib/vault/search";

type CommandPaletteProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Initial mode when opening (⇧⌘P → commands, ⌘P → go) */
	mode: PaletteMode;
	vaultPath: string | null;
	/** In-memory catalog rows for instant title/author quick-open. */
	papers: PaperMetadata[];
	/** Commands for ⇧⌘P / `>` mode */
	commands: AppCommand[];
	/** Open a paper by its vault-relative folder (e.g. papers/x). */
	onOpenPaper: (paperRel: string) => void;
	/** Open a vault-relative file (e.g. notes/idea.md). */
	onOpenVaultRel: (rel: string) => void;
};

const PAPER_LIMIT = 8;

/**
 * Global palette: Go (⌘P) = papers + vault search;
 * Commands (⇧⌘P) = executable app actions. Leading `>` forces commands mode.
 */
export function CommandPalette({
	open,
	onOpenChange,
	mode,
	vaultPath,
	papers,
	commands,
	onOpenPaper,
	onOpenVaultRel,
}: CommandPaletteProps) {
	const { t } = useTranslation("app");
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [loading, setLoading] = useState(false);
	const genRef = useRef(0);

	// Reset query when opening or when mode changes while open.
	useEffect(() => {
		if (open) setQuery(mode === "commands" ? ">" : "");
	}, [open, mode]);

	const effectiveMode: PaletteMode = useMemo(() => {
		const q = query.trimStart();
		if (q.startsWith(">")) return "commands";
		return mode;
	}, [query, mode]);

	const commandQuery = useMemo(() => {
		const q = query.trimStart();
		if (q.startsWith(">")) return q.slice(1).trimStart();
		return effectiveMode === "commands" ? q : "";
	}, [query, effectiveMode]);

	const goQuery = useMemo(() => {
		if (effectiveMode === "commands") return "";
		return query.trimStart().startsWith(">")
			? query.trimStart().slice(1)
			: query;
	}, [query, effectiveMode]);

	const visibleCommands = useMemo(() => {
		const available = commands.filter((c) => (c.when ? c.when() : true));
		return filterByFuzzy(available, commandQuery, (c) => {
			const title = t(c.titleKey as "commandPalette.title");
			const cat = c.categoryKey
				? t(c.categoryKey as "commandPalette.title")
				: "";
			const kw = c.keywords?.join(" ") ?? "";
			return `${cat} ${title} ${kw} ${c.id}`;
		});
	}, [commands, commandQuery, t]);

	// Instant, in-memory paper matches (title / authors / id). Empty query → recents.
	const paperMatches = useMemo(() => {
		if (effectiveMode !== "go") return [];
		const withPath = papers.filter((p) => p.path);
		const terms = goQuery.toLowerCase().split(/\s+/).filter(Boolean);
		if (!terms.length) return withPath.slice(0, PAPER_LIMIT);
		return withPath
			.filter((p) => {
				const hay =
					`${p.title} ${p.authors?.join(" ") ?? ""} ${p.id}`.toLowerCase();
				return terms.every((term) => hay.includes(term));
			})
			.slice(0, PAPER_LIMIT);
	}, [papers, goQuery, effectiveMode]);

	// Debounced backend full-text search over Vault Markdown.
	useEffect(() => {
		if (!open || !vaultPath || effectiveMode !== "go") {
			setHits([]);
			setLoading(false);
			return;
		}
		const q = goQuery.trim();
		if (!q) {
			setHits([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		const gen = ++genRef.current;
		const timer = setTimeout(() => {
			searchVault({ vaultPath, query: q, limit: 60 })
				.then((r) => {
					if (gen === genRef.current) setHits(r.hits);
				})
				.catch((error) => {
					if (gen === genRef.current) {
						setHits([]);
						notifyError(cloudAiError(error));
					}
				})
				.finally(() => {
					if (gen === genRef.current) setLoading(false);
				});
		}, 200);
		return () => clearTimeout(timer);
	}, [goQuery, open, vaultPath, effectiveMode]);

	const choosePaper = (rel: string) => {
		onOpenPaper(rel);
		onOpenChange(false);
	};
	const chooseHit = (hit: SearchHit) => {
		if (hit.paperPath) onOpenPaper(hit.paperPath);
		else onOpenVaultRel(hit.path);
		onOpenChange(false);
	};
	const runCommand = (cmd: AppCommand) => {
		onOpenChange(false);
		void Promise.resolve(cmd.run()).catch(() => undefined);
	};

	const hasGoResults = paperMatches.length > 0 || hits.length > 0;
	const hasCmdResults = visibleCommands.length > 0;

	const placeholder =
		effectiveMode === "commands"
			? t("commandPalette.commandsPlaceholder")
			: t("commandPalette.placeholder");

	const title =
		effectiveMode === "commands"
			? t("commandPalette.commandsTitle")
			: t("commandPalette.title");

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			className="max-w-xl"
			title={title}
			description={placeholder}
		>
			<Command shouldFilter={false} loop>
				<CommandInput
					value={query}
					onValueChange={setQuery}
					placeholder={placeholder}
				/>
				<CommandList>
					{effectiveMode === "commands" ? (
						hasCmdResults ? (
							<CommandGroup heading={t("commandPalette.commands")}>
								{visibleCommands.map((cmd) => {
									const titleText = t(cmd.titleKey as "commandPalette.title");
									const catText = cmd.categoryKey
										? t(cmd.categoryKey as "commandPalette.title")
										: "";
									return (
										<CommandItem
											key={cmd.id}
											value={`cmd:${cmd.id}`}
											onSelect={() => runCommand(cmd)}
										>
											<CommandIcon id={cmd.id} />
											<div className="flex min-w-0 flex-col">
												<span className="truncate">
													{catText ? (
														<>
															<span className="text-muted-foreground">
																{catText}:{" "}
															</span>
															{titleText}
														</>
													) : (
														titleText
													)}
												</span>
											</div>
										</CommandItem>
									);
								})}
							</CommandGroup>
						) : (
							<div className="px-3 py-6 text-center text-muted-foreground text-sm">
								{commandQuery
									? t("commandPalette.noResults")
									: t("commandPalette.commandsEmpty")}
							</div>
						)
					) : (
						<>
							{paperMatches.length ? (
								<CommandGroup
									heading={
										goQuery
											? t("commandPalette.papers")
											: t("commandPalette.recent")
									}
								>
									{paperMatches.map((p) => (
										<CommandItem
											key={p.path}
											value={`paper:${p.path}`}
											onSelect={() => choosePaper(p.path as string)}
										>
											<FileText className="text-muted-foreground" />
											<div className="flex min-w-0 flex-col">
												<span className="truncate">{p.title || p.id}</span>
												{p.authors?.length ? (
													<span className="truncate text-muted-foreground text-xs">
														{p.authors.join(", ")}
														{p.year ? ` · ${p.year}` : ""}
													</span>
												) : null}
											</div>
										</CommandItem>
									))}
								</CommandGroup>
							) : null}

							{hits.length ? (
								<CommandGroup heading={t("commandPalette.contents")}>
									{hits.map((hit) => (
										<CommandItem
											key={hit.path}
											value={`hit:${hit.path}`}
											onSelect={() => chooseHit(hit)}
										>
											<FileText className="text-muted-foreground" />
											<div className="flex min-w-0 flex-col">
												<span className="truncate">{hit.title}</span>
												<span className="truncate text-muted-foreground text-xs">
													{hit.snippet}
												</span>
											</div>
										</CommandItem>
									))}
								</CommandGroup>
							) : null}

							{loading ? (
								<div className="flex items-center gap-2 px-3 py-3 text-muted-foreground text-xs">
									<Loader2 className="size-3.5 animate-spin" />
									{t("commandPalette.searching")}
								</div>
							) : null}

							{!loading && !hasGoResults ? (
								<div className="px-3 py-6 text-center text-muted-foreground text-sm">
									{!vaultPath
										? t("commandPalette.noVault")
										: goQuery
											? t("commandPalette.noResults")
											: t("commandPalette.empty")}
								</div>
							) : null}
						</>
					)}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

function CommandIcon({ id }: { id: string }) {
	const Icon: LucideIcon = id.startsWith("settings.")
		? Settings2
		: id.startsWith("vault.") || id.startsWith("library.")
			? FileText
			: SquareTerminal;
	return <Icon className="text-muted-foreground" />;
}
