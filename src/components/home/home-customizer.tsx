import {
	ArrowDown,
	ArrowUp,
	ImagePlus,
	Loader2,
	LocateFixed,
	Settings2,
	X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
import { IconButton } from "@/components/viewer/visual/controls";
import { cloudAiError } from "@/lib/cloud/ai";
import {
	HOME_WIDGETS,
	type HomeSettings,
	saveHomeBackground,
	saveHomeSettings,
} from "@/lib/cloud/home-settings";
import { cloudFetch } from "@/lib/cloud/sync";
import { notifyError } from "@/lib/core/notify";

export function HomeCustomizer({
	settings,
	localId,
	onSaved,
	disabled = false,
}: {
	settings: HomeSettings;
	localId: string | null;
	onSaved: () => Promise<void>;
	disabled?: boolean;
}) {
	const { t, i18n } = useTranslation("app");
	const formId = useId();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(settings);
	const [baseline, setBaseline] = useState(localId);
	const [file, setFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const saving = useRef(false);
	const [cityQuery, setCityQuery] = useState("");
	const [cities, setCities] = useState<NonNullable<HomeSettings["city"]>[]>([]);
	const [cityBusy, setCityBusy] = useState(false);
	const [locating, setLocating] = useState(false);
	const [citySearched, setCitySearched] = useState(false);
	const cityRequest = useRef<AbortController | null>(null);
	useEffect(() => () => cityRequest.current?.abort(), []);
	const save = async () => {
		if (saving.current || cityBusy) return;
		saving.current = true;
		setBusy(true);
		try {
			const value = {
				...draft,
				background: {
					...draft.background,
					path: file ? await saveHomeBackground(file) : draft.background.path,
				},
			};
			await saveHomeSettings(value, baseline);
			await onSaved();
			setOpen(false);
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			saving.current = false;
			setBusy(false);
		}
	};
	const findCity = async () => {
		cityRequest.current?.abort();
		const controller = new AbortController();
		cityRequest.current = controller;
		setLocating(false);
		setCityBusy(true);
		try {
			const response = await cloudFetch(
				`/api/weather/cities?${new URLSearchParams({ q: cityQuery.trim(), lang: i18n.language.startsWith("zh") ? "zh" : "en" })}`,
				{ signal: controller.signal },
			);
			const data = await response.json();
			if (!controller.signal.aborted) {
				setCities(data.cities);
				setCitySearched(true);
			}
		} catch (error) {
			if (!controller.signal.aborted) notifyError(cloudAiError(error));
		} finally {
			if (!controller.signal.aborted) setCityBusy(false);
		}
	};
	const locate = () => {
		if (cityBusy || saving.current) return;
		if (!navigator.geolocation) {
			notifyError(t("home.weather.locationUnsupported"));
			return;
		}
		cityRequest.current?.abort();
		const controller = new AbortController();
		cityRequest.current = controller;
		setCityBusy(true);
		setLocating(true);
		const finish = () => {
			setCityBusy(false);
			setLocating(false);
		};
		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				if (controller.signal.aborted) return;
				// Weather needs only approximate coordinates, including in synced settings.
				const latitude = Math.round(coords.latitude * 100) / 100;
				const longitude = Math.round(coords.longitude * 100) / 100;
				if (
					!Number.isFinite(latitude) ||
					!Number.isFinite(longitude) ||
					Math.abs(latitude) > 90 ||
					Math.abs(longitude) > 180
				) {
					notifyError(t("home.weather.locationFailed"));
					finish();
					return;
				}
				setDraft((current) => ({
					...current,
					city: { name: t("home.weather.locatedPlace"), latitude, longitude },
				}));
				setCities([]);
				setCitySearched(false);
				finish();
			},
			(error) => {
				if (controller.signal.aborted) return;
				notifyError(
					t(
						error.code === 1
							? "home.weather.locationDenied"
							: error.code === 3
								? "home.weather.locationTimeout"
								: "home.weather.locationFailed",
					),
				);
				finish();
			},
			{ enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 },
		);
	};
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) return;
				cityRequest.current?.abort();
				setCityBusy(false);
				setLocating(false);
				if (next) {
					setDraft(settings);
					setBaseline(localId);
					setFile(null);
					setCities([]);
					setCitySearched(false);
				}
				setOpen(next);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm" disabled={disabled}>
					<Settings2 className="size-4" />
					{t("home.customize")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{t("home.customize")}</DialogTitle>
				</DialogHeader>
				<div className="space-y-6">
					<div className="space-y-2">
						<h3 className="text-sm font-medium">{t("home.widgets.title")}</h3>
						{[
							...draft.widgets.map((widget) => widget.id),
							...HOME_WIDGETS.filter(
								(id) => !draft.widgets.some((widget) => widget.id === id),
							),
						].map((id) => {
							const index = draft.widgets.findIndex(
									(widget) => widget.id === id,
								),
								widget = draft.widgets[index];
							const move = (direction: number) => {
								const widgets = [...draft.widgets];
								[widgets[index], widgets[index + direction]] = [
									widgets[index + direction],
									widgets[index],
								];
								setDraft({ ...draft, widgets });
							};
							return (
								<div
									key={id}
									className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-muted/40"
								>
									<label
										htmlFor={`${formId}-${id}`}
										className="flex min-w-0 flex-1 items-center gap-3 text-sm"
									>
										<Checkbox
											id={`${formId}-${id}`}
											checked={index >= 0}
											onCheckedChange={(checked) =>
												setDraft({
													...draft,
													widgets: checked
														? [...draft.widgets, { id, width: 2 }]
														: draft.widgets.filter((item) => item.id !== id),
												})
											}
										/>
										{t(`home.widgets.${id}`)}
									</label>
									{widget && (
										<>
											<select
												className="h-8 rounded border bg-background text-xs"
												aria-label={t("home.widgetWidth", {
													name: t(`home.widgets.${id}`),
												})}
												value={widget.width}
												onChange={(event) =>
													setDraft({
														...draft,
														widgets: draft.widgets.map((item) =>
															item.id === id
																? {
																		...item,
																		width: Number(event.target.value) as
																			| 1
																			| 2
																			| 4,
																	}
																: item,
														),
													})
												}
											>
												{([1, 2, 4] as const).map((width) => (
													<option key={width} value={width}>
														{t(`home.width${width}`)}
													</option>
												))}
											</select>
											<IconButton
												label={t("home.moveUp", {
													name: t(`home.widgets.${id}`),
												})}
												disabled={index === 0}
												onClick={() => move(-1)}
											>
												<ArrowUp />
											</IconButton>
											<IconButton
												label={t("home.moveDown", {
													name: t(`home.widgets.${id}`),
												})}
												disabled={index === draft.widgets.length - 1}
												onClick={() => move(1)}
											>
												<ArrowDown />
											</IconButton>
										</>
									)}
								</div>
							);
						})}
					</div>
					<div className="space-y-3">
						<h3 className="text-sm font-medium">{t("home.background")}</h3>
						<div className="flex items-center gap-2">
							<label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm focus-within:ring-2 focus-within:ring-ring">
								<ImagePlus className="size-4" />
								{file?.name ?? t("home.chooseBackground")}
								<input
									className="sr-only"
									type="file"
									accept="image/png,image/jpeg,image/webp"
									aria-label={t("home.chooseBackground")}
									onChange={(event) => setFile(event.target.files?.[0] ?? null)}
								/>
							</label>
							{(file || draft.background.path) && (
								<IconButton
									label={t("home.removeBackground")}
									onClick={() => {
										setFile(null);
										setDraft({
											...draft,
											background: { ...draft.background, path: undefined },
										});
									}}
								>
									<X />
								</IconButton>
							)}
						</div>
						{(["blur", "shade"] as const).map((key) => (
							<label key={key} className="flex items-center gap-3 text-sm">
								<span className="w-20 shrink-0">{t(`home.${key}`)}</span>
								<input
									type="range"
									className="min-w-0 flex-1 accent-primary"
									min={0}
									max={key === "blur" ? 30 : 95}
									value={draft.background[key]}
									onChange={(event) =>
										setDraft({
											...draft,
											background: {
												...draft.background,
												[key]: Number(event.target.value),
											},
										})
									}
								/>
								<span className="w-12 text-right text-xs tabular-nums">
									{draft.background[key]}
									{key === "blur" ? "px" : "%"}
								</span>
							</label>
						))}
					</div>
					<div className="space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-sm font-medium">{t("home.weather.city")}</h3>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								disabled={cityBusy || busy}
								onClick={locate}
							>
								{locating ? (
									<Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
								) : (
									<LocateFixed className="size-4" />
								)}
								{t("home.weather.useLocation")}
							</Button>
						</div>
						{draft.city && (
							<p className="text-sm text-muted-foreground">{draft.city.name}</p>
						)}
						<form
							className="flex gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								void findCity();
							}}
						>
							<Input
								disabled={locating || busy}
								value={cityQuery}
								onChange={(event) => setCityQuery(event.target.value)}
								placeholder={t("home.weather.searchCity")}
								aria-label={t("home.weather.searchCity")}
							/>
							<Button
								variant="secondary"
								disabled={cityBusy || busy || cityQuery.trim().length < 2}
							>
								{t("home.weather.search")}
							</Button>
						</form>
						<ul>
							{cities.map((city) => (
								<li key={`${city.latitude}:${city.longitude}`}>
									<Button
										disabled={locating || busy}
										variant="ghost"
										className="h-auto w-full justify-start whitespace-normal text-left"
										onClick={() => {
											setDraft({ ...draft, city });
											setCities([]);
											setCitySearched(false);
										}}
									>
										{city.name}
									</Button>
								</li>
							))}
						</ul>
						{citySearched && !cities.length && (
							<p className="text-xs text-muted-foreground">
								{t("home.weather.noCities")}
							</p>
						)}
					</div>
					<Button
						className="w-full"
						disabled={busy || cityBusy}
						onClick={() => void save()}
					>
						{t("home.saveLayout")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
