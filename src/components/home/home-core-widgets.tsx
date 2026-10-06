import { ArrowUpRight, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useVisibleNow } from "@/hooks/use-visible-now";
import type { useHomeData } from "./use-home-data";
export function HomeClock() {
	const { t, i18n } = useTranslation("app");
	const now = new Date(useVisibleNow());
	return (
		<div className="min-w-0 w-full text-center">
			<time
				role="timer"
				aria-label={t("home.clock")}
				dateTime={now.toISOString()}
				className="block whitespace-nowrap font-light text-[clamp(1.5rem,14cqw,3rem)] tabular-nums tracking-tight"
			>
				{now.toLocaleTimeString(i18n.language, { hour12: false })}
			</time>
			<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
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

export function HomeProgress({
	label,
	completed,
	total,
	percent: suppliedPercent,
	detail,
}: {
	label: string;
	completed: number;
	total: number;
	percent?: number;
	detail?: string;
}) {
	const percent =
		suppliedPercent ?? (total ? Math.round((completed / total) * 100) : 0);
	return (
		<div className="h-full space-y-3 rounded-xl border bg-card/90 p-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="font-medium text-sm">{label}</h2>
				<span className="text-muted-foreground text-xs tabular-nums">
					{detail ?? `${completed} / ${total}`}
				</span>
			</div>
			<div className="flex items-center gap-4">
				<progress
					aria-label={label}
					max={100}
					value={percent}
					className="h-2 min-w-0 flex-1 overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
				/>
				<span className="w-12 shrink-0 text-right font-medium text-sm tabular-nums">
					{percent}%
				</span>
			</div>
		</div>
	);
}

export function HomeTasks({
	data,
	onOpenFile,
}: {
	data: ReturnType<typeof useHomeData>;
	onOpenFile?: (path: string) => void;
}) {
	const { t } = useTranslation("app");
	const {
		board,
		busy,
		overview,
		preferences,
		choose,
		done,
		inbox,
		title,
		setTitle,
		add,
		pending,
		toggle,
		completed,
	} = data;
	return (
		<div
			className="h-full space-y-4 rounded-xl border bg-card/90 p-5 @min-[28rem]/home-widget:p-6"
			aria-busy={busy}
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="font-semibold">{t("home.tasks")}</h2>
				{board && onOpenFile && (
					<Button
						variant="ghost"
						size="sm"
						className="h-auto min-h-7 max-w-full whitespace-normal"
						onClick={() => onOpenFile(board.path)}
					>
						{t("home.openBoard")}
						<ArrowUpRight className="size-4" />
					</Button>
				)}
			</div>
			{board && (
				<div className="flex flex-wrap gap-3">
					<label className="flex min-w-0 basis-full items-center gap-2 text-muted-foreground text-xs @min-[28rem]/home-widget:flex-1 @min-[28rem]/home-widget:basis-0">
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
					<label className="flex min-w-0 basis-full items-center gap-2 text-muted-foreground text-xs @min-[28rem]/home-widget:flex-1 @min-[28rem]/home-widget:basis-0">
						{t("home.doneColumn")}
						<select
							disabled={busy}
							className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-foreground"
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
				className="flex min-w-0 gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void add();
				}}
			>
				<Input
					className="min-w-0 flex-1"
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
					disabled={busy || !overview || !title.trim() || (!!board && !inbox)}
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
					<li
						key={card.id}
						className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3"
					>
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
						<span className="min-w-0 basis-full truncate pl-7 text-muted-foreground text-xs @min-[24rem]/home-widget:max-w-28 @min-[24rem]/home-widget:basis-auto @min-[24rem]/home-widget:pl-0">
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
								<span className="min-w-0 flex-1 break-words text-muted-foreground text-sm line-through">
									{card.title}
								</span>
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}
