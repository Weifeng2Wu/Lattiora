import {
	ArrowLeft,
	ArrowUpRight,
	BookCheck,
	BookOpen,
	CheckCheck,
	FileText,
	Plus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useVisibleNow } from "@/hooks/use-visible-now";
import { cloudAiError } from "@/lib/cloud/ai";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import {
	createHomeBoard,
	homeDoneColumn,
	loadHomeOverview,
	saveHomeBoard,
} from "@/lib/cloud/home";
import { notifyError } from "@/lib/core/notify";
import { libraryStore } from "@/lib/paper/library-store";
import { moveKanbanCard } from "@/lib/workspace/visual-documents";
import { ConferenceCountdowns } from "./conference-countdowns";

const preferenceKey = "agentero-home-view-v1";
type Preferences = { board?: string; done: Record<string, string> };
function readPreferences(): Preferences {
	try {
		const value = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
		if (value && typeof value.done === "object" && value.done) return value;
	} catch {
		/* View preferences are optional. */
	}
	return { done: {} };
}

function HomeClock() {
	const { t, i18n } = useTranslation("app");
	const now = new Date(useVisibleNow());
	return (
		<div className="shrink-0 text-left sm:text-right">
			<time
				role="timer"
				aria-label={t("home.clock")}
				dateTime={now.toISOString()}
				className="font-light text-4xl tabular-nums tracking-tight sm:text-5xl"
			>
				{now.toLocaleTimeString(i18n.language, { hour12: false })}
			</time>
			<p className="mt-2 text-muted-foreground text-sm">
				{now.toLocaleDateString(i18n.language, {
					year: "numeric",
					month: "long",
					day: "numeric",
					weekday: "long",
				})}
			</p>
		</div>
	);
}

function HomeProgress({
	label,
	completed,
	total,
}: {
	label: string;
	completed: number;
	total: number;
}) {
	const percent = total ? Math.round((completed / total) * 100) : 0;
	return (
		<div className="space-y-3 rounded-xl border bg-card p-5">
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-medium text-sm">{label}</h2>
				<span className="text-muted-foreground text-xs tabular-nums">
					{completed} / {total}
				</span>
			</div>
			<div className="flex items-center gap-4">
				<progress
					aria-label={label}
					max={100}
					value={percent}
					className="h-2 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
				/>
				<span className="w-12 text-right font-medium text-sm tabular-nums">
					{percent}%
				</span>
			</div>
		</div>
	);
}

export function HomePage({
	onBack,
	onOpenFile,
}: {
	onBack?: () => void;
	onOpenFile?: (path: string) => void;
}) {
	const { t } = useTranslation(["app", "viewer", "common"]);
	const papers = useStore(libraryStore, (state) => state.papers);
	const [overview, setOverview] = useState<Awaited<
		ReturnType<typeof loadHomeOverview>
	> | null>(null);
	const [preferences, setPreferences] = useState(readPreferences);
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const generation = useRef(0);
	const refresh = useCallback(async () => {
		const id = ++generation.current;
		try {
			const next = await loadHomeOverview();
			if (id !== generation.current) return;
			setOverview(next);
			if (next.unavailable)
				notifyError(t("home.unavailableBoards", { count: next.unavailable }), {
					id: "home-boards",
				});
		} catch (error) {
			notifyError(cloudAiError(error));
		}
	}, [t]);
	useEffect(() => {
		void refresh();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsubscribe = subscribeCloudFiles(() => {
			clearTimeout(timer);
			timer = setTimeout(() => void refresh(), 150);
		});
		return () => {
			generation.current++;
			clearTimeout(timer);
			unsubscribe();
		};
	}, [refresh]);
	const choose = (next: Preferences) => {
		setPreferences(next);
		try {
			localStorage.setItem(preferenceKey, JSON.stringify(next));
		} catch {
			/* The current view still works. */
		}
	};
	const board =
		overview?.boards.find((item) => item.path === preferences.board) ??
		overview?.boards[0];
	const done = board
		? homeDoneColumn(board.doc, preferences.done[board.path])
		: null;
	const inbox = board?.doc.columns.find((column) => column.id !== done?.id);
	const cards = useMemo(
		() =>
			board?.doc.columns.flatMap((column) =>
				column.cards.map((card) => ({
					...card,
					columnId: column.id,
					columnTitle: column.title,
				})),
			) ?? [],
		[board],
	);
	const pending = cards.filter((card) => card.columnId !== done?.id);
	const completed = cards.filter((card) => card.columnId === done?.id);
	const read = papers.filter((paper) => paper.is_read).length;
	const run = async (operation: () => Promise<void>) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		try {
			await operation();
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			await refresh();
			running.current = false;
			setBusy(false);
		}
	};
	const add = () =>
		run(async () => {
			if (!title.trim()) return;
			if (board) {
				if (!inbox) return;
				await saveHomeBoard(board, {
					...board.doc,
					columns: board.doc.columns.map((column) =>
						column.id === inbox.id
							? {
									...column,
									cards: [
										...column.cards,
										{
											id: crypto.randomUUID(),
											title: title.trim(),
											description: "",
										},
									],
								}
							: column,
					),
				});
			} else {
				const path = await createHomeBoard(title.trim(), [
					t("viewer:visual.todo"),
					t("viewer:visual.doing"),
					t("viewer:visual.done"),
				]);
				choose({ ...preferences, board: path });
			}
			setTitle("");
		});
	const toggle = (cardId: string, checked: boolean) =>
		run(async () => {
			if (!board || !done || !inbox) return;
			await saveHomeBoard(
				board,
				moveKanbanCard(board.doc, cardId, checked ? done.id : inbox.id),
			);
		});
	return (
		<section
			aria-label={t("home.title")}
			className="h-full overflow-auto overscroll-contain bg-muted/20"
		>
			<div className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8 lg:p-10">
				<header className="flex flex-col items-stretch gap-6 lg:flex-row lg:items-start">
					<div className="shrink-0">
						<p className="mb-2 font-medium text-muted-foreground text-xs tracking-widest">
							{t("common:brand.name")}
						</p>
						<h1 className="font-semibold text-3xl tracking-tight">
							{t("home.title")}
						</h1>
						{onBack && (
							<Button
								variant="ghost"
								size="sm"
								className="mt-3 -ml-2"
								onClick={onBack}
							>
								<ArrowLeft className="size-4" />
								{t("home.back")}
							</Button>
						)}
					</div>
					<ConferenceCountdowns />
					<HomeClock />
				</header>
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					{[
						{ label: t("home.papers"), value: papers.length, icon: BookOpen },
						{ label: t("home.read"), value: read, icon: BookCheck },
						{
							label: t("home.notes"),
							value: overview?.notes ?? "—",
							icon: FileText,
						},
						{
							label: t("home.pending"),
							value: overview ? pending.length : "—",
							icon: CheckCheck,
						},
					].map(({ label, value, icon: Icon }) => (
						<div key={label} className="rounded-xl border bg-card p-5">
							<div className="mb-4 flex items-center justify-between gap-2 text-muted-foreground">
								<span className="text-xs">{label}</span>
								<Icon className="size-4" />
							</div>
							<p className="font-semibold text-3xl tabular-nums tracking-tight">
								{value}
							</p>
						</div>
					))}
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<HomeProgress
						label={t("home.readingProgress")}
						completed={read}
						total={papers.length}
					/>
					<HomeProgress
						label={t("home.taskProgress")}
						completed={completed.length}
						total={cards.length}
					/>
				</div>
				<div
					className="space-y-4 rounded-xl border bg-card p-5 sm:p-6"
					aria-busy={busy}
				>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 className="font-semibold">{t("home.tasks")}</h2>
						{board && onOpenFile && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onOpenFile(board.path)}
							>
								{t("home.openBoard")}
								<ArrowUpRight className="size-4" />
							</Button>
						)}
					</div>
					{board && (
						<div className="flex flex-wrap gap-3">
							<label className="flex min-w-0 basis-full items-center gap-2 text-muted-foreground text-xs sm:flex-1 sm:basis-auto">
								{t("home.board")}
								<select
									disabled={busy}
									className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-foreground"
									value={board.path}
									onChange={(event) =>
										choose({ ...preferences, board: event.target.value })
									}
								>
									{overview?.boards.map((item) => (
										<option key={item.path} value={item.path}>
											{item.path
												.replace(/^notes\//, "")
												.replace(/\.kanban\.json$/i, "")}
										</option>
									))}
								</select>
							</label>
							<label className="flex items-center gap-2 text-muted-foreground text-xs">
								{t("home.doneColumn")}
								<select
									disabled={busy}
									className="h-9 max-w-40 rounded-md border bg-background px-2 text-foreground"
									value={done?.id ?? ""}
									onChange={(event) =>
										choose({
											...preferences,
											done: {
												...preferences.done,
												[board.path]: event.target.value,
											},
										})
									}
								>
									<option value="">{t("home.chooseDone")}</option>
									{board.doc.columns.map((column) => (
										<option key={column.id} value={column.id}>
											{column.title}
										</option>
									))}
								</select>
							</label>
						</div>
					)}
					<form
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void add();
						}}
					>
						<Input
							aria-label={t("home.newTask")}
							placeholder={t("home.newTask")}
							value={title}
							disabled={busy || !overview || (!!board && !inbox)}
							onChange={(event) => setTitle(event.target.value)}
						/>
						<Button
							type="submit"
							size="icon"
							aria-label={t("home.addTask")}
							disabled={
								busy || !overview || !title.trim() || (!!board && !inbox)
							}
						>
							<Plus className="size-4" />
						</Button>
					</form>
					{!pending.length && (
						<p className="py-6 text-center text-muted-foreground text-sm">
							{t(overview ? "home.noTasks" : "home.loading")}
						</p>
					)}
					<ul className="divide-y">
						{pending.map((card) => (
							<li key={card.id} className="flex items-start gap-3 py-3">
								<Checkbox
									className="mt-1"
									checked={false}
									disabled={busy || !done || !inbox}
									aria-label={t("home.completeTask", { title: card.title })}
									onCheckedChange={() => void toggle(card.id, true)}
								/>
								<div className="min-w-0 flex-1">
									<p className="break-words text-sm">{card.title}</p>
									{card.description && (
										<p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground text-xs">
											{card.description}
										</p>
									)}
								</div>
								<span className="max-w-28 truncate text-muted-foreground text-xs">
									{card.columnTitle}
								</span>
							</li>
						))}
					</ul>
					{!!completed.length && (
						<details>
							<summary className="text-muted-foreground text-sm">
								{t("home.completed", { count: completed.length })}
							</summary>
							<ul className="mt-2 divide-y">
								{completed.map((card) => (
									<li key={card.id} className="flex items-center gap-3 py-3">
										<Checkbox
											checked
											disabled={busy || !inbox}
											aria-label={t("home.reopenTask", { title: card.title })}
											onCheckedChange={() => void toggle(card.id, false)}
										/>
										<span className="break-words text-muted-foreground text-sm line-through">
											{card.title}
										</span>
									</li>
								))}
							</ul>
						</details>
					)}
				</div>
			</div>
		</section>
	);
}
