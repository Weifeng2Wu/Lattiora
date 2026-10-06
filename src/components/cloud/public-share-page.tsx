import { Download, Loader2, LockKeyhole } from "lucide-react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	isNoteShareSnapshot,
	NOTE_SHARE_MIME,
	type NoteShareSnapshot,
	type ShareFormat,
} from "@/lib/cloud/share-protocol";
import { shareError } from "@/lib/cloud/shares";
import { CloudHttpError, cloudFetch } from "@/lib/cloud/sync";
import { notifyError } from "@/lib/core/notify";

const SharedPdfPreview = lazy(() => import("./shared-pdf-preview"));
const SharedMarkdown = lazy(() => import("./shared-markdown"));

type Snapshot = {
	url: string;
	title: string;
	format: ShareFormat;
	notes: NoteShareSnapshot["notes"] | null;
};
export function PublicSharePage({ id }: { id: string }) {
	const { t } = useTranslation("editor");
	const [metadata, setMetadata] = useState<{
		hasKey: boolean;
		expiresAt: number | null;
	} | null>(null);
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const [reload, setReload] = useState(0);
	const inFlight = useRef(false);
	const objectUrl = useRef<string | null>(null);
	const path = `/api/public-shares/${id}`;
	const clearSnapshot = useCallback(() => {
		if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
		objectUrl.current = null;
		setSnapshot(null);
	}, []);
	useEffect(() => {
		const controller = new AbortController();
		void reload; // Explicit refresh retries a failed request without changing its URL.
		setFailure("");
		setMetadata(null);
		if (!/^[a-f0-9]{32}$/.test(id)) {
			setFailure(t("share.errors.shareUnavailable"));
			return;
		}
		void cloudFetch(path, {
			credentials: "omit",
			cache: "no-store",
			signal: controller.signal,
		})
			.then((response) => response.json())
			.then((value) => {
				if (!controller.signal.aborted) setMetadata(value);
			})
			.catch((error) => {
				if (!controller.signal.aborted) setFailure(shareError(error));
			});
		return () => controller.abort();
	}, [id, path, reload, t]);
	useEffect(
		() => () => {
			if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
		},
		[],
	);
	// Revalidate on returning to the page; never restore a cached snapshot offline.
	useEffect(() => {
		if (!snapshot || !metadata) return;
		let checking = false;
		let active = true;
		const check = async () => {
			if (checking || document.hidden) return;
			checking = true;
			try {
				if (metadata.expiresAt !== null && metadata.expiresAt <= Date.now())
					throw new Error("shareUnavailable");
				await cloudFetch(path, { credentials: "omit", cache: "no-store" });
			} catch (error) {
				if (active) {
					clearSnapshot();
					setFailure(shareError(error));
				}
			} finally {
				checking = false;
			}
		};
		const timer = window.setInterval(() => void check(), 30000);
		const expiryTimer =
			metadata.expiresAt === null ||
			metadata.expiresAt - Date.now() > 2147483647
				? undefined
				: window.setTimeout(
						() => {
							clearSnapshot();
							setFailure(t("share.errors.shareUnavailable"));
						},
						Math.min(2147483647, Math.max(0, metadata.expiresAt - Date.now())),
					);
		const onVisible = () => void check();
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("pageshow", onVisible);
		return () => {
			active = false;
			window.clearInterval(timer);
			window.clearTimeout(expiryTimer);
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("pageshow", onVisible);
		};
	}, [snapshot, metadata, path, t, clearSnapshot]);
	const openSnapshot = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		try {
			const response = await cloudFetch(path, {
				method: "POST",
				credentials: "omit",
				cache: "no-store",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ key }),
			});
			const blob = await response.blob();
			const format = response.headers.get("x-share-format") as ShareFormat;
			const title = decodeURIComponent(
				response.headers.get("x-share-title") ?? "",
			);
			let notes: NoteShareSnapshot["notes"] | null = null;
			if (response.headers.get("content-type") === NOTE_SHARE_MIME) {
				const value: unknown = JSON.parse(await blob.text());
				if (!isNoteShareSnapshot(value)) throw new Error("invalidShare");
				notes = value.notes;
			} else if (format === "md")
				notes = [{ title, markdown: await blob.text() }];
			clearSnapshot();
			objectUrl.current = URL.createObjectURL(blob);
			setSnapshot({
				url: objectUrl.current,
				title,
				format,
				notes,
			});
			setKey("");
		} catch (error) {
			if (error instanceof CloudHttpError && error.status === 404)
				setFailure(shareError(error));
			else notifyError(shareError(error));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}, [path, key, clearSnapshot]);
	useEffect(() => {
		if (metadata && !metadata.hasKey) void openSnapshot();
	}, [metadata, openSnapshot]);
	return (
		<main className="flex h-dvh flex-col overflow-auto bg-background text-foreground">
			<header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
				<span className="text-sm font-medium">{t("share.brand")}</span>
				{snapshot && (
					<>
						<h1
							className="min-w-0 flex-1 truncate text-sm"
							title={snapshot.title}
						>
							{snapshot.title}
						</h1>
						{snapshot.format !== "md" && (
							<Button asChild variant="outline" size="sm">
								<a
									href={snapshot.url}
									download={`${snapshot.title}.${snapshot.format}`}
								>
									<Download className="size-4" aria-hidden />
									{t("share.download")}
								</a>
							</Button>
						)}
					</>
				)}
			</header>
			{failure ? (
				<div className="m-auto max-w-sm space-y-4 p-6 text-center">
					<p role="status">{failure}</p>
					<Button
						variant="outline"
						onClick={() => {
							clearSnapshot();
							setReload((value) => value + 1);
						}}
					>
						{t("share.refresh")}
					</Button>
				</div>
			) : snapshot ? (
				snapshot.format === "png" ? (
					<img
						src={snapshot.url}
						alt={snapshot.title}
						className="mx-auto h-auto max-w-full shrink-0"
					/>
				) : snapshot.format === "pdf" ? (
					<Suspense
						fallback={
							<p role="status" className="m-auto p-6">
								{t("share.loading")}
							</p>
						}
					>
						<SharedPdfPreview url={snapshot.url} />
					</Suspense>
				) : (
					<Suspense
						fallback={
							<p role="status" className="m-auto p-6">
								{t("share.loading")}
							</p>
						}
					>
						{snapshot.notes && <SharedMarkdown notes={snapshot.notes} />}
					</Suspense>
				)
			) : metadata ? (
				<form
					className="m-auto w-full max-w-sm space-y-4 p-6"
					onSubmit={(event) => {
						event.preventDefault();
						void openSnapshot();
					}}
				>
					<h1 className="text-lg font-semibold">{t("share.open")}</h1>
					{metadata.hasKey && (
						<>
							<Label htmlFor="public-share-key">
								<LockKeyhole className="size-4" aria-hidden />
								{t("share.key")}
							</Label>
							<Input
								id="public-share-key"
								type="password"
								required
								value={key}
								maxLength={128}
								autoComplete="off"
								disabled={busy}
								onChange={(event) => setKey(event.target.value)}
							/>
						</>
					)}
					<Button
						type="submit"
						className="w-full"
						disabled={busy || (metadata.hasKey && !key)}
					>
						{busy && (
							<Loader2
								className="size-4 animate-spin motion-reduce:animate-none"
								aria-hidden
							/>
						)}
						{t("share.open")}
					</Button>
				</form>
			) : (
				<p role="status" className="m-auto p-6">
					{t("share.loading")}
				</p>
			)}
		</main>
	);
}
