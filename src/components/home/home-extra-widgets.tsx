import {
	ArrowUpRight,
	CloudSun,
	Pause,
	Play,
	RefreshCw,
	RotateCcw,
	Timer,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/viewer/visual/controls";
import { useVisibleNow } from "@/hooks/use-visible-now";
import { cloudAiError } from "@/lib/cloud/ai";
import type { HomeSettings } from "@/lib/cloud/home-settings";
import { cloudFetch } from "@/lib/cloud/sync";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";
import type { useHomeData } from "./use-home-data";

export function HomeRecent({
	data,
	onOpenFile,
}: {
	data: ReturnType<typeof useHomeData>;
	onOpenFile?: (path: string) => void;
}) {
	const { t } = useTranslation("app");
	const recent = data.papers
		.map((paper) => ({
			paper,
			reading: paper.path ? data.overview?.reading.get(paper.path) : undefined,
		}))
		.filter((entry) => entry.reading?.lastReadAt)
		.sort((a, b) => (b.reading?.lastReadAt ?? 0) - (a.reading?.lastReadAt ?? 0))
		.slice(0, 5);
	return (
		<div className="h-full rounded-xl border bg-card/90 p-5">
			<h2 className="mb-3 text-sm font-medium">{t("home.widgets.recent")}</h2>
			<ul className="divide-y">
				{recent.map(({ paper, reading }) => (
					<li key={paper.id}>
						<button
							type="button"
							className="flex w-full items-center gap-3 rounded py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
							disabled={!onOpenFile || !paper.path}
							onClick={() =>
								paper.path &&
								onOpenFile?.(`${paper.path}#page=${reading?.lastPage ?? 1}`)
							}
						>
							<span className="min-w-0 flex-1">
								<span className="line-clamp-2 break-words text-sm">
									{paper.title}
								</span>
								<span className="mt-1 block text-xs text-muted-foreground">
									{t("home.pageCoverage", {
										count: reading?.pages.length ?? 0,
										total: reading?.pageCount ?? 0,
									})}
								</span>
							</span>
							{onOpenFile && <ArrowUpRight className="size-4 shrink-0" />}
						</button>
					</li>
				))}
			</ul>
			{!recent.length && (
				<p className="py-4 text-sm text-muted-foreground">
					{t("home.noRecent")}
				</p>
			)}
		</div>
	);
}

type TimerState = { seconds: number; remaining: number; endAt: number | null };
const TIMER_KEY = "agentero-home-focus";
function readTimer(): TimerState {
	const value = readJsonStorage<Partial<TimerState>>(TIMER_KEY, {});
	return value &&
		typeof value.seconds === "number" &&
		value.seconds >= 60 &&
		value.seconds <= 7200 &&
		typeof value.remaining === "number" &&
		Number.isFinite(value.remaining) &&
		value.remaining >= 0 &&
		value.remaining <= 7200 &&
		(value.endAt === null ||
			(typeof value.endAt === "number" && Number.isFinite(value.endAt)))
		? (value as TimerState)
		: { seconds: 1500, remaining: 1500, endAt: null };
}
export function HomeFocus() {
	const { t } = useTranslation("app");
	const [timer, setTimer] = useState(readTimer);
	const now = useVisibleNow();
	const remaining = timer.endAt
		? Math.max(0, Math.ceil((timer.endAt - now) / 1000))
		: timer.remaining;
	const save = useCallback((next: TimerState) => {
		setTimer(next);
		writeJsonStorage(TIMER_KEY, next);
	}, []);
	useEffect(() => {
		if (timer.endAt && remaining === 0) {
			save({ ...timer, remaining: 0, endAt: null });
			notifySuccess(t("home.focus.complete"));
		}
	}, [remaining, timer, save, t]);
	return (
		<div className="h-full space-y-4 rounded-xl border bg-card/90 p-5">
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-medium">{t("home.widgets.focus")}</h2>
				<Timer className="size-4 shrink-0 text-muted-foreground" />
			</div>
			<p
				className="text-[clamp(1.75rem,14cqw,2.5rem)] font-light tabular-nums"
				role="timer"
				aria-label={t("home.widgets.focus")}
			>
				{Math.floor(remaining / 60)
					.toString()
					.padStart(2, "0")}
				:{(remaining % 60).toString().padStart(2, "0")}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<IconButton
					label={t(timer.endAt ? "home.focus.pause" : "home.focus.start")}
					onClick={() =>
						save(
							timer.endAt
								? {
										...timer,
										remaining: Math.max(
											0,
											Math.ceil((timer.endAt - Date.now()) / 1000),
										),
										endAt: null,
									}
								: {
										...timer,
										endAt: Date.now() + (remaining || timer.seconds) * 1000,
									},
						)
					}
				>
					{timer.endAt ? <Pause /> : <Play />}
				</IconButton>
				<IconButton
					label={t("home.focus.reset")}
					onClick={() =>
						save({ ...timer, remaining: timer.seconds, endAt: null })
					}
				>
					<RotateCcw />
				</IconButton>
				<label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
					<input
						type="number"
						min={1}
						max={120}
						className="w-14 rounded border bg-background px-2 py-1"
						aria-label={t("home.focus.minutes")}
						disabled={!!timer.endAt}
						value={timer.seconds / 60}
						onChange={(event) => {
							const minutes = Number(event.target.value);
							if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 120)
								save({
									seconds: minutes * 60,
									remaining: minutes * 60,
									endAt: null,
								});
						}}
					/>
					{t("home.focus.minutes")}
				</label>
			</div>
		</div>
	);
}

type Weather = {
	temperature: number;
	high: number;
	low: number;
	code: number;
	fetchedAt: number;
};
function weatherKind(code: number) {
	if (code === 0) return "clear";
	if (code <= 3) return "cloudy";
	if (code <= 48) return "fog";
	if (code >= 95) return "storm";
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
	return "rain";
}
export function HomeWeather({ city }: { city: HomeSettings["city"] }) {
	const { t, i18n } = useTranslation("app");
	const key = city ? `agentero-weather:${city.latitude}:${city.longitude}` : "";
	const [weather, setWeather] = useState<Weather | null>(null);
	const [busy, setBusy] = useState(false);
	const controller = useRef<AbortController | null>(null);
	const refresh = useCallback(async () => {
		if (!city || !navigator.onLine || controller.current) return;
		const abort = new AbortController();
		controller.current = abort;
		setBusy(true);
		try {
			const response = await cloudFetch(
				`/api/weather?latitude=${city.latitude}&longitude=${city.longitude}`,
				{ signal: abort.signal },
			);
			const result: Weather = await response.json();
			if (
				![
					result.temperature,
					result.high,
					result.low,
					result.code,
					result.fetchedAt,
				].every(Number.isFinite)
			)
				throw new Error("invalidProviderResponse");
			if (!abort.signal.aborted) {
				setWeather(result);
				writeJsonStorage(key, result);
			}
		} catch (error) {
			if (!abort.signal.aborted) notifyError(cloudAiError(error));
		} finally {
			if (controller.current === abort) {
				controller.current = null;
				setBusy(false);
			}
		}
	}, [city, key]);
	useEffect(() => {
		const cached = readJsonStorage<Weather | null>(key, null);
		const valid =
			cached &&
			[
				cached.temperature,
				cached.high,
				cached.low,
				cached.code,
				cached.fetchedAt,
			].every(Number.isFinite)
				? cached
				: null;
		setWeather(valid);
		if (!valid || Date.now() - valid.fetchedAt > 1800000) void refresh();
		window.addEventListener("online", refresh);
		return () => {
			window.removeEventListener("online", refresh);
			controller.current?.abort();
			controller.current = null;
		};
	}, [key, refresh]);
	return (
		<div className="h-full rounded-xl border bg-card/90 p-5">
			<div className="flex items-center justify-between gap-2">
				<h2
					className="min-w-0 flex-1 break-words text-sm font-medium"
					title={city?.name}
				>
					{city?.name ?? t("home.widgets.weather")}
				</h2>
				<IconButton
					label={t("research.refresh")}
					disabled={busy || !city}
					onClick={() => void refresh()}
				>
					<RefreshCw
						className={busy ? "animate-spin motion-reduce:animate-none" : ""}
					/>
				</IconButton>
			</div>
			{weather ? (
				<>
					<div className="my-3 flex flex-wrap items-center gap-4">
						<CloudSun className="size-9 shrink-0 text-primary" />
						<p className="text-[clamp(1.75rem,14cqw,2.5rem)] font-light tabular-nums">
							{Math.round(weather.temperature)}°
						</p>
					</div>
					<p className="text-sm">
						{t(`home.weather.${weatherKind(weather.code)}`)} ·{" "}
						{Math.round(weather.low)}° / {Math.round(weather.high)}°
					</p>
					<p className="mt-2 text-xs text-muted-foreground">
						{t("home.weather.updated", {
							time: new Date(weather.fetchedAt).toLocaleString(i18n.language, {
								month: "short",
								day: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							}),
						})}
					</p>
				</>
			) : (
				<p className="py-5 text-sm text-muted-foreground">
					{t(city ? "home.weather.unavailable" : "home.weather.chooseCity")}
				</p>
			)}
			<a
				href="https://open-meteo.com/"
				target="_blank"
				rel="noopener noreferrer"
				className="mt-4 inline-block text-xs text-muted-foreground underline underline-offset-2"
			>
				Open-Meteo
			</a>
		</div>
	);
}
