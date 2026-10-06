import {
	ArrowLeft,
	BookCheck,
	BookOpen,
	CheckCheck,
	FileText,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cloudAiError } from "@/lib/cloud/ai";
import { readLocalFile, subscribeCloudFiles } from "@/lib/cloud/files";
import {
	defaultHomeSettings,
	HOME_SETTINGS_PATH,
	type HomeSettings,
	type HomeWidgetId,
	readHomeSettings,
	saveHomeSettings,
} from "@/lib/cloud/home-settings";
import { notifyError } from "@/lib/core/notify";
import { ConferenceCountdowns } from "./conference-countdowns";
import { HomeCapture } from "./home-capture";
import { HomeClock, HomeProgress, HomeTasks } from "./home-core-widgets";
import { HomeCustomizer } from "./home-customizer";
import { HomeFocus, HomeRecent, HomeWeather } from "./home-extra-widgets";
import { HomeWidgetGrid } from "./home-widget-grid";
import { useHomeData } from "./use-home-data";

export function HomePage({
	onBack,
	onOpenFile,
}: {
	onBack?: () => void;
	onOpenFile?: (path: string) => void;
}) {
	const { t } = useTranslation(["app", "common"]);
	const data = useHomeData();
	const [settings, setSettings] = useState<{
		value: HomeSettings;
		localId: string | null;
	}>({ value: defaultHomeSettings, localId: null });
	const [settingsReady, setSettingsReady] = useState(false);
	const [moving, setMoving] = useState(false);
	const savingOrder = useRef(false);
	const [moveAnnouncement, setMoveAnnouncement] = useState("");
	const [background, setBackground] = useState<string | null>(null);
	const mounted = useRef(true);
	const generation = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++generation.current;
		try {
			const next = await readHomeSettings();
			if (mounted.current && request === generation.current) {
				setSettings(next);
				setSettingsReady(true);
			}
		} catch (error) {
			if (mounted.current && request === generation.current)
				notifyError(cloudAiError(error));
		}
	}, []);
	useEffect(() => {
		mounted.current = true;
		void refresh();
		const unsubscribe = subscribeCloudFiles((paths) => {
			if (paths.includes(HOME_SETTINGS_PATH)) void refresh();
		});
		return () => {
			mounted.current = false;
			generation.current++;
			unsubscribe();
		};
	}, [refresh]);
	useEffect(() => {
		let disposed = false,
			generation = 0,
			url: string | undefined;
		setBackground(null);
		const path = settings.value.background.path;
		const load = async () => {
			if (!path) return;
			const request = ++generation;
			try {
				const blob = await readLocalFile(path);
				if (disposed || request !== generation) return;
				if (url) URL.revokeObjectURL(url);
				url = URL.createObjectURL(blob);
				setBackground(url);
			} catch {
				if (!disposed && request === generation)
					notifyError(t("home.backgroundFailed"), { id: "home-background" });
			}
		};
		void load();
		const unsubscribe = subscribeCloudFiles((paths) => {
			if (path && paths.includes(path)) void load();
		});
		return () => {
			disposed = true;
			unsubscribe();
			if (url) URL.revokeObjectURL(url);
		};
	}, [settings.value.background.path, t]);
	const moveWidget = async (
		from: HomeWidgetId,
		to: HomeWidgetId,
		baseline: string | null,
	) => {
		if (!settingsReady || savingOrder.current) return;
		const source = settings.value.widgets.findIndex((item) => item.id === from);
		const target = settings.value.widgets.findIndex((item) => item.id === to);
		if (source < 0 || target < 0 || source === target) return;
		savingOrder.current = true;
		setMoving(true);
		try {
			if (baseline !== settings.localId) throw new Error("localConflict");
			const widgets = [...settings.value.widgets];
			const [widget] = widgets.splice(source, 1);
			widgets.splice(target, 0, widget);
			const next = { ...settings.value, widgets };
			setSettings({ ...settings, value: next });
			await saveHomeSettings(next, baseline);
			setMoveAnnouncement(
				t("home.widgetMoved", {
					name: t(`home.widgets.${from}`),
					position: target + 1,
				}),
			);
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			await refresh();
			savingOrder.current = false;
			if (mounted.current) setMoving(false);
		}
	};
	const readingRatio = data.papers.reduce((sum, paper) => {
		const progress = paper.path
			? data.overview?.reading.get(paper.path)
			: undefined;
		return (
			sum +
			(paper.is_read
				? 1
				: progress?.pageCount
					? progress.pages.length / progress.pageCount
					: 0)
		);
	}, 0);
	const started = data.papers.filter(
		(paper) =>
			!paper.is_read &&
			paper.path &&
			(data.overview?.reading.get(paper.path)?.pages.length ?? 0) > 0,
	).length;
	const stats = {
		papers: {
			label: t("home.papers"),
			value: data.papers.length,
			icon: BookOpen,
		},
		read: { label: t("home.read"), value: data.read, icon: BookCheck },
		notes: {
			label: t("home.notes"),
			value: data.overview?.notes ?? "—",
			icon: FileText,
		},
		pending: {
			label: t("home.pending"),
			value: data.overview ? data.pending.length : "—",
			icon: CheckCheck,
		},
	};
	const renderWidget = (id: HomeWidgetId): ReactNode => {
		if (id in stats) {
			const { label, value, icon: Icon } = stats[id as keyof typeof stats];
			return (
				<div className="h-full rounded-xl border bg-card/90 p-5">
					<div className="mb-4 flex items-center justify-between gap-2 text-muted-foreground">
						<h2 className="text-xs">{label}</h2>
						<Icon className="size-4" />
					</div>
					<p className="font-semibold text-[clamp(1.5rem,12cqw,1.875rem)] tabular-nums tracking-tight">
						{value}
					</p>
				</div>
			);
		}
		switch (id) {
			case "capture":
				return <HomeCapture onOpenFile={onOpenFile} />;
			case "clock":
				return (
					<div className="flex h-full items-center justify-center rounded-xl border bg-card/90 p-5">
						<HomeClock />
					</div>
				);
			case "conferences":
				return (
					<div className="h-full rounded-xl border bg-card/90 p-5">
						<ConferenceCountdowns />
					</div>
				);
			case "reading":
				return (
					<HomeProgress
						label={t("home.readingProgress")}
						completed={data.read}
						total={data.papers.length}
						percent={
							data.papers.length
								? Math.round((readingRatio / data.papers.length) * 100)
								: 0
						}
						detail={t("home.readingDetail", { read: data.read, started })}
					/>
				);
			case "taskProgress":
				return (
					<HomeProgress
						label={t("home.taskProgress")}
						completed={data.completed.length}
						total={data.cards.length}
					/>
				);
			case "tasks":
				return <HomeTasks data={data} onOpenFile={onOpenFile} />;
			case "recent":
				return <HomeRecent data={data} onOpenFile={onOpenFile} />;
			case "weather":
				return <HomeWeather city={settings.value.city} />;
			case "focus":
				return <HomeFocus />;
		}
	};
	return (
		<section
			aria-label={t("home.title")}
			className="relative isolate h-full overflow-hidden bg-muted/20"
		>
			{background && (
				<>
					<div
						className="pointer-events-none absolute -inset-10 -z-20 bg-cover bg-center"
						style={{
							backgroundImage: `url(${background})`,
							filter: `blur(${settings.value.background.blur}px)`,
						}}
						data-home-background
					/>
					<div
						className="pointer-events-none absolute inset-0 -z-10 bg-background"
						style={{ opacity: settings.value.background.shade / 100 }}
					/>
				</>
			)}
			<div className="h-full overflow-auto overscroll-contain" data-home-scroll>
				<div className="@container/home-grid mx-auto max-w-6xl space-y-6 p-5 sm:p-8 lg:p-10">
					<header className="flex flex-wrap items-center justify-between gap-4">
						<div>
							<p className="mb-2 font-medium text-muted-foreground text-xs tracking-widest">
								{t("common:brand.name")}
							</p>
							<h1 className="font-semibold text-3xl tracking-tight">
								{t("home.title")}
							</h1>
						</div>
						<div className="flex flex-wrap gap-2">
							{onBack && (
								<Button variant="ghost" size="sm" onClick={onBack}>
									<ArrowLeft className="size-4" />
									{t("home.back")}
								</Button>
							)}
							{settingsReady && (
								<HomeCustomizer
									settings={settings.value}
									localId={settings.localId}
									disabled={moving}
									onSaved={refresh}
								/>
							)}
						</div>
					</header>
					<HomeWidgetGrid
						widgets={settings.value.widgets}
						localId={settings.localId}
						disabled={!settingsReady || moving}
						onMove={moveWidget}
					>
						{renderWidget}
					</HomeWidgetGrid>
					<p className="sr-only" role="status">
						{moveAnnouncement}
					</p>
					{!settings.value.widgets.length && (
						<p className="py-12 text-center text-sm text-muted-foreground">
							{t("home.noWidgets")}
						</p>
					)}
				</div>
			</div>
		</section>
	);
}
