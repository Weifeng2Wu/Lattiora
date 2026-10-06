import { ArrowUpRight, CalendarClock, Plus, RefreshCw, X } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useOverlayRegistration } from "@/hooks/use-overlay-registration";
import { useVisibleNow } from "@/hooks/use-visible-now";
import {
	type Conference,
	deadlineCountdown,
	nextConferenceRound,
	selectableConferences,
} from "@/lib/cloud/conference-deadlines";
import {
	CONFERENCE_CACHE_TTL,
	type ConferenceCatalog,
	conferenceSelectionKey,
	readConferenceCatalog,
	readConferenceSelection,
	refreshConferenceCatalog,
	saveConferenceSelection,
} from "@/lib/cloud/conferences";
import { notifyError } from "@/lib/core/notify";

function CountdownRows({
	conferences,
	selected,
	remove,
}: {
	conferences: Conference[];
	selected: string[];
	remove: (id: string) => void;
}) {
	const { t, i18n } = useTranslation("app");
	const now = useVisibleNow();
	const formatDate = (time: number) =>
		new Date(time).toLocaleString(i18n.language, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			timeZoneName: "short",
		});
	const rows = selected
		.map((id) => {
			const conference = conferences.find((item) => item.id === id);
			const round = conference ? nextConferenceRound(conference, now) : null;
			return { id, conference, round };
		})
		.sort((a, b) => {
			const order = (at: number | null | undefined) =>
				at != null && at > now ? at : Number.POSITIVE_INFINITY;
			return order(a.round?.at) - order(b.round?.at);
		});
	return (
		<div className="divide-y">
			{rows.map(({ id, conference, round }) => {
				const title = conference
					? `${conference.title} ${conference.year}`
					: id;
				const expired = round?.at != null && round.at <= now;
				const countdown =
					round?.at != null && !expired
						? deadlineCountdown(round.at, now)
						: null;
				return (
					<article
						key={id}
						aria-label={title}
						className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] @min-[24rem]/home-widget:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-0.5 py-2"
					>
						<h3 className="min-w-0 font-medium text-sm">
							{conference?.link ? (
								<a
									className="flex min-w-0 items-center gap-1 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
									href={conference.link}
									target="_blank"
									rel="noopener noreferrer"
									title={title}
								>
									<span className="truncate">{title}</span>
									<ArrowUpRight
										aria-hidden="true"
										className="size-3 shrink-0 text-muted-foreground"
									/>
								</a>
							) : (
								<span className="block truncate" title={title}>
									{title}
								</span>
							)}
						</h3>
						<div className="col-start-1 row-start-3 min-w-0 @min-[24rem]/home-widget:col-span-2 @min-[24rem]/home-widget:row-start-2 text-muted-foreground text-xs tabular-nums">
							{round?.at != null && (
								<time
									dateTime={new Date(round.at).toISOString()}
									title={`${round.deadline} ${conference?.timezone}`}
								>
									{formatDate(round.at)}
								</time>
							)}
						</div>
						<div
							role="timer"
							aria-label={t("home.conferences.countdown", { title })}
							className="col-start-1 row-start-2 min-w-0 flex flex-wrap items-baseline @min-[24rem]/home-widget:col-start-2 @min-[24rem]/home-widget:row-start-1 @min-[24rem]/home-widget:justify-end gap-x-1 font-medium text-sm tabular-nums"
						>
							{countdown ? (
								<>
									<span>{countdown.days}</span>
									<span className="font-normal text-muted-foreground text-xs">
										{t("home.conferences.days")}
									</span>
									<span>{countdown.time}</span>
								</>
							) : (
								<span className="max-w-36 text-right font-normal text-muted-foreground text-xs">
									{t(
										!conference
											? "home.conferences.unlisted"
											: expired
												? "home.conferences.closed"
												: "home.conferences.tbd",
									)}
								</span>
							)}
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							className="col-start-2 row-span-3 row-start-1 @min-[24rem]/home-widget:col-start-3 @min-[24rem]/home-widget:row-span-2 size-11 text-muted-foreground sm:size-8"
							aria-label={t("home.conferences.remove", { title })}
							title={t("home.conferences.remove", { title })}
							onClick={() => remove(id)}
						>
							<X className="size-4" />
						</Button>
					</article>
				);
			})}
		</div>
	);
}

export function ConferenceCountdowns() {
	const { t, i18n } = useTranslation("app");
	const fieldId = useId();
	const [catalog, setCatalog] = useState<ConferenceCatalog | null>(null);
	const [selected, setSelected] = useState(readConferenceSelection);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [rank, setRank] = useState("");
	const [category, setCategory] = useState("");
	const [busy, setBusy] = useState(true);
	const fetching = useRef(false);
	const mounted = useRef(false);
	useOverlayRegistration("home-conferences", open, () => setOpen(false));
	const refresh = useCallback(async () => {
		if (fetching.current) return;
		fetching.current = true;
		setBusy(true);
		try {
			const next = await refreshConferenceCatalog();
			if (mounted.current) setCatalog(next);
		} catch {
			if (mounted.current) notifyError(t("home.conferences.loadFailed"));
		} finally {
			fetching.current = false;
			if (mounted.current) setBusy(false);
		}
	}, [t]);
	useEffect(() => {
		mounted.current = true;
		let cancelled = false;
		void (async () => {
			try {
				const cached = await readConferenceCatalog();
				if (cancelled) return;
				setCatalog(cached);
				setBusy(false);
				if (
					navigator.onLine &&
					(!cached || Date.now() - cached.updatedAt >= CONFERENCE_CACHE_TTL)
				)
					void refresh();
			} catch {
				if (!cancelled) {
					setBusy(false);
					notifyError(t("home.conferences.loadFailed"));
				}
			}
		})();
		const storage = (event: StorageEvent) => {
			if (event.key === conferenceSelectionKey || event.key === null)
				setSelected(readConferenceSelection());
		};
		const online = () => void refresh();
		window.addEventListener("storage", storage);
		window.addEventListener("online", online);
		return () => {
			cancelled = true;
			mounted.current = false;
			window.removeEventListener("storage", storage);
			window.removeEventListener("online", online);
		};
	}, [refresh, t]);
	const choose = (id: string, checked: boolean) => {
		try {
			// Read the latest view preference before modifying it across tabs.
			const current = readConferenceSelection();
			const next = checked
				? [...new Set([...current, id])]
				: current.filter((value) => value !== id);
			saveConferenceSelection(next);
			setSelected(next);
		} catch {
			notifyError(t("home.conferences.saveFailed"));
		}
	};
	const options = useMemo(() => {
		const all = selectableConferences(catalog?.conferences ?? [], Date.now());
		return all.sort(
			(a, b) => a.title.localeCompare(b.title) || b.year - a.year,
		);
	}, [catalog]);
	const visible = options.filter(
		(item) =>
			(!rank || item.rank === rank) &&
			(!category || item.category === category) &&
			`${item.title} ${item.year} ${item.description}`
				.toLocaleLowerCase()
				.includes(query.trim().toLocaleLowerCase()),
	);
	return (
		<section
			aria-label={t("home.conferences.title")}
			className="min-w-0 flex-1 space-y-1"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="flex items-center gap-2 font-medium text-muted-foreground text-xs">
					<CalendarClock
						className="size-4 text-muted-foreground"
						aria-hidden="true"
					/>
					{t("home.conferences.title")}
				</h2>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-11 sm:size-8"
						aria-label={t("home.conferences.refresh")}
						title={t("home.conferences.refresh")}
						disabled={busy}
						onClick={() => void refresh()}
					>
						<RefreshCw
							className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
						/>
					</Button>
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								className="size-11 sm:size-8"
								aria-label={t("home.conferences.choose")}
								title={t("home.conferences.choose")}
							>
								<Plus className="size-4" />
							</Button>
						</DialogTrigger>
						<DialogContent
							className="max-h-[85dvh] sm:max-w-xl"
							aria-describedby={undefined}
						>
							<DialogHeader>
								<DialogTitle>{t("home.conferences.choose")}</DialogTitle>
							</DialogHeader>
							<Input
								aria-label={t("home.conferences.search")}
								placeholder={t("home.conferences.search")}
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
							<div className="flex gap-2">
								<select
									aria-label={t("home.conferences.rank")}
									className="h-11 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:h-9"
									value={rank}
									onChange={(event) => setRank(event.target.value)}
								>
									<option value="">{t("home.conferences.allRanks")}</option>
									{["A", "B", "C", "N"].map((value) => (
										<option key={value} value={value}>
											{t("home.conferences.rankValue", { rank: value })}
										</option>
									))}
								</select>
								<select
									aria-label={t("home.conferences.category")}
									className="h-11 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:h-9"
									value={category}
									onChange={(event) => setCategory(event.target.value)}
								>
									<option value="">
										{t("home.conferences.allCategories")}
									</option>
									{[...new Set(options.map((item) => item.category))]
										.sort()
										.map((value) => (
											<option key={value} value={value}>
												{value}
											</option>
										))}
								</select>
							</div>
							<div
								className="h-80 max-h-[45dvh] overflow-y-auto overscroll-contain"
								aria-busy={busy}
							>
								{!visible.length && (
									<p className="py-10 text-muted-foreground text-xs">
										{t(
											busy
												? "home.conferences.loading"
												: !catalog
													? "home.conferences.noCache"
													: "home.conferences.noResults",
										)}
									</p>
								)}
								{visible.map((conference) => (
									<label
										key={conference.id}
										htmlFor={`${fieldId}-${conference.id}`}
										className="flex min-h-14 cursor-default items-center gap-3 rounded-md px-2 py-3 hover:bg-muted/60"
									>
										<Checkbox
											id={`${fieldId}-${conference.id}`}
											aria-describedby={`${fieldId}-${conference.id}-description`}
											checked={selected.includes(conference.id)}
											aria-label={`${conference.title} ${conference.year}`}
											onCheckedChange={(checked) =>
												choose(conference.id, checked === true)
											}
										/>
										<span className="min-w-0 flex-1">
											<span className="font-medium text-sm">
												{conference.title} {conference.year}
											</span>
											<span
												id={`${fieldId}-${conference.id}-description`}
												className="mt-0.5 block truncate text-muted-foreground text-xs"
												title={conference.description}
											>
												{conference.description}
											</span>
										</span>
										<span className="shrink-0 text-muted-foreground text-xs">
											{t("home.conferences.rankValue", {
												rank: conference.rank,
											})}
										</span>
									</label>
								))}
							</div>
							<div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
								<a
									className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
									href="https://github.com/ccfddl/ccf-deadlines"
									target="_blank"
									rel="noopener noreferrer"
								>
									{t("home.conferences.source")}
									<ArrowUpRight className="size-3" aria-hidden="true" />
								</a>
								{catalog && (
									<span>
										{t("home.conferences.updated", {
											date: new Date(catalog.updatedAt).toLocaleString(
												i18n.language,
												{
													month: "short",
													day: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												},
											),
										})}
									</span>
								)}
							</div>
						</DialogContent>
					</Dialog>
				</div>
			</div>
			{selected.length && !catalog ? (
				<p className="py-2 text-muted-foreground text-xs">
					{t(busy ? "home.conferences.loading" : "home.conferences.noCache")}
				</p>
			) : selected.length ? (
				<CountdownRows
					conferences={catalog?.conferences ?? []}
					selected={selected}
					remove={(id) => choose(id, false)}
				/>
			) : (
				<p className="py-2 text-muted-foreground text-xs">
					{t("home.conferences.empty")}
				</p>
			)}
		</section>
	);
}
