import i18n from "@/i18n";
import { cloudFetch } from "@/lib/cloud/sync";
/**
 * Embedded web page for a Plaza source, with in-frame browsing.
 *
 * Sources that set `embedOrigin` are served through a Host proxy scheme, which
 * retargets the site's `target="_blank"` links so clicks navigate in place and
 * posts each navigation back here. That message stream is the history stack
 * behind Back / Forward — the frame's own `history` object is not usable once it
 * follows a link off to a third-party origin.
 *
 * Navigation is applied by remounting the frame at the target path, so it never
 * pushes entries onto the app's own session history.
 */

import { ArrowLeft, ArrowRight, ExternalLink, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cloudAiError } from "@/lib/cloud/ai";
import { cacheHtmlPreview, loadHtmlPage } from "@/lib/cloud/html-reader";
import { notifyError } from "@/lib/core/notify";
import { openExternalUrl } from "@/lib/core/open-external";
import { cn } from "@/lib/core/utils";
import { importPlazaPaper, type PlazaImportRequest } from "@/lib/plaza/import";

/** No `allow-popups`: every link must resolve inside this frame. */
const SANDBOX = "allow-scripts allow-same-origin allow-forms";

type NavMessage = {
	source: "agentero-plaza";
	/** In-frame navigation that just happened. */
	path?: string;
	/** Third-party link the frame refused to follow; open it outside. */
	external?: string;
	/**
	 * Same-origin path the frame declined to render in place (a feed). Reopened
	 * against the upstream site, since the browser cannot resolve our scheme.
	 */
	externalPath?: string;
	/** A paper row's `[入库]` was clicked. */
	importPaper?: PlazaImportRequest;
	errorCode?: string;
};

function isNavMessage(data: unknown): data is NavMessage {
	if (typeof data !== "object" || data === null) return false;
	const value = data as Partial<NavMessage>;
	if (value.source !== "agentero-plaza") return false;
	return (
		typeof value.errorCode === "string" ||
		typeof value.path === "string" ||
		typeof value.external === "string" ||
		typeof value.externalPath === "string" ||
		typeof value.importPaper === "object"
	);
}

export function PlazaWebFrame({
	homeUrl,
	embedOrigin,
	title,
	className,
}: {
	/** Canonical public URL, used for "open in browser". */
	homeUrl: string;
	/** Proxy scheme origin, or null to embed `homeUrl` directly. */
	embedOrigin: string | null;
	title: string;
	className?: string;
}) {
	const { t } = useTranslation("sidebar");
	const homePath = `${new URL(homeUrl).pathname || "/"}${new URL(homeUrl).search}`;
	/** Visited paths and the cursor into them. Grown by proxy nav messages. */
	const [nav, setNav] = useState<{ stack: string[]; index: number }>({
		stack: [homePath],
		index: 0,
	});
	/**
	 * What the frame is mounted at. `epoch` is bumped only by Back / Forward /
	 * Reload: the iframe key depends on it alone, so a link click inside the
	 * frame records history without remounting (which would reload this path and
	 * snap the user back to where the frame started).
	 */
	const [frame, setFrame] = useState({ path: homePath, epoch: 0 });
	const proxied = new URL(homeUrl).hostname === "papers.cool";
	const [preview, setPreview] = useState<{
		path: string;
		epoch: number;
		url: string;
	} | null>(null);
	const site = proxied
		? "coolpapers"
		: new URL(homeUrl).hostname === "modelscope.cn"
			? "modelscope"
			: null;
	const [online, setOnline] = useState(navigator.onLine);
	const observedPath = useRef(homePath);
	observedPath.current = nav.stack[nav.index] ?? homePath;
	const [live, setLive] = useState<{
		path: string;
		epoch: number;
		origin: string;
		src: string;
	} | null>(null);
	useEffect(() => {
		const changed = () => {
			setFrame((previous) =>
				previous.path === observedPath.current
					? previous
					: { path: observedPath.current, epoch: previous.epoch + 1 },
			);
			setOnline(navigator.onLine);
		};
		window.addEventListener("online", changed);
		window.addEventListener("offline", changed);
		return () => {
			window.removeEventListener("online", changed);
			window.removeEventListener("offline", changed);
		};
	}, []);
	useEffect(() => {
		if (!site) return;
		const controller = new AbortController();
		let release: (() => Promise<boolean>) | undefined;
		setPreview(null);
		setLive(null);
		void (async () => {
			if (online) {
				try {
					const result = await cloudFetch("/api/plaza/session", {
						method: "POST",
						headers: { "content-type": "application/json" },
						signal: controller.signal,
						body: JSON.stringify({
							site,
							labels: {
								import: i18n.t("cloud:plaza.import"),
								pending: i18n.t("cloud:plaza.pending"),
								done: i18n.t("cloud:plaza.done"),
							},
						}),
					});
					const grant = (await result.json()) as {
						origin: string;
						bootstrap: string;
					};
					const bootstrap = new URL(grant.bootstrap);
					if (
						bootstrap.origin !== grant.origin ||
						grant.origin === location.origin
					)
						throw new Error("invalidProviderResponse");
					bootstrap.searchParams.set("path", frame.path);
					if (!controller.signal.aborted)
						setLive({
							path: frame.path,
							epoch: frame.epoch,
							origin: grant.origin,
							src: bootstrap.href,
						});
					return;
				} catch (error) {
					if (controller.signal.aborted) return;
					if (!proxied) throw error;
				}
			}
			if (!proxied) throw new Error("notCached");
			const page = await loadHtmlPage(
				new URL(frame.path, homeUrl).href,
				controller.signal,
			);
			const cached = await cacheHtmlPreview(
				page,
				controller.signal,
				"coolpapers",
			);
			if (controller.signal.aborted) {
				void cached.release();
				return;
			}
			release = cached.release;
			setPreview({ path: frame.path, epoch: frame.epoch, url: cached.url });
		})().catch((error) => {
			if (!controller.signal.aborted) notifyError(cloudAiError(error));
		});
		return () => {
			controller.abort();
			void release?.();
		};
	}, [site, proxied, homeUrl, frame, online]);

	/** Needed to post import results back into the frame. */
	const frameRef = useRef<HTMLIFrameElement>(null);
	/** While HTML5 DnD is active, disable frame hit-testing so dragover reaches
	 *  dockview drop targets (the frame otherwise swallows drag events). */
	const [dragShield, setDragShield] = useState(false);

	useEffect(() => {
		const arm = () => setDragShield(true);
		const disarm = () => setDragShield(false);
		window.addEventListener("dragstart", arm, true);
		window.addEventListener("dragend", disarm, true);
		window.addEventListener("drop", disarm, true);
		return () => {
			window.removeEventListener("dragstart", arm, true);
			window.removeEventListener("dragend", disarm, true);
			window.removeEventListener("drop", disarm, true);
		};
	}, []);

	useEffect(() => {
		if (!site) return;
		const onMessage = (event: MessageEvent) => {
			if (
				event.origin !== (live?.origin ?? "null") ||
				event.source !== frameRef.current?.contentWindow ||
				!isNavMessage(event.data)
			)
				return;
			const { path, external, externalPath, importPaper, errorCode } =
				event.data;
			if (errorCode) {
				notifyError(cloudAiError(new Error(errorCode)));
				return;
			}
			if (external) {
				openExternalUrl(external);
				return;
			}
			if (externalPath) {
				openExternalUrl(new URL(externalPath, homeUrl).href);
				return;
			}
			if (importPaper) {
				if (!navigator.userActivation.isActive) return;
				void importPlazaPaper(importPaper).then((ok) => {
					frameRef.current?.contentWindow?.postMessage(
						{
							source: "agentero-plaza-host",
							importedId: importPaper.id,
							ok,
						},
						"*",
					);
				});
				return;
			}
			if (!path) return;
			try {
				if (new URL(path, homeUrl).origin !== new URL(homeUrl).origin) return;
			} catch {
				return;
			}
			if (!live)
				setFrame((previous) =>
					previous.path === path
						? previous
						: { path, epoch: previous.epoch + 1 },
				);
			if (live && proxied)
				void loadHtmlPage(new URL(path, homeUrl).href).catch(() => undefined);
			setNav((prev) => {
				// Already at this entry — either a reload, or the load caused by our
				// own Back / Forward, which moved the cursor before the frame reported.
				if (prev.stack[prev.index] === path) return prev;
				// A new navigation truncates anything ahead of the cursor.
				const stack = [...prev.stack.slice(0, prev.index + 1), path];
				return { stack, index: stack.length - 1 };
			});
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [site, proxied, homeUrl, live]);

	const jump = useCallback((delta: number) => {
		setNav((prev) => {
			const index = prev.index + delta;
			const path = prev.stack[index];
			if (path == null) return prev;
			setFrame((f) => ({ path, epoch: f.epoch + 1 }));
			return { ...prev, index };
		});
	}, []);

	const canGoBack = nav.index > 0;
	const canGoForward = nav.index < nav.stack.length - 1;
	const currentPath = nav.stack[nav.index] ?? homePath;
	const frameSrc =
		live && live.path === frame.path && live.epoch === frame.epoch
			? live.src
			: site === "modelscope"
				? null
				: proxied
					? preview?.path === frame.path && preview.epoch === frame.epoch
						? preview.url
						: null
					: embedOrigin
						? `${embedOrigin}${frame.path}`
						: homeUrl;

	return (
		<div
			className={cn(
				"flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background",
				className,
			)}
		>
			<div className="flex h-8 shrink-0 select-none items-center gap-0.5 border-b px-1.5">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={t("plaza.back")}
							disabled={!canGoBack}
							onClick={() => jump(-1)}
						>
							<ArrowLeft className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{t("plaza.back")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={t("plaza.forward")}
							disabled={!canGoForward}
							onClick={() => jump(1)}
						>
							<ArrowRight className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{t("plaza.forward")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={t("plaza.reload")}
							onClick={() =>
								setFrame((f) => ({ path: currentPath, epoch: f.epoch + 1 }))
							}
						>
							<RotateCw className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{t("plaza.reload")}</TooltipContent>
				</Tooltip>
				<span
					className="ml-1 min-w-0 flex-1 truncate text-caption text-muted-foreground"
					title={currentPath}
				>
					{currentPath}
				</span>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={t("plaza.openInSystemBrowser")}
							onClick={() =>
								openExternalUrl(new URL(currentPath, homeUrl).href)
							}
						>
							<ExternalLink className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						{t("plaza.openInSystemBrowser")}
					</TooltipContent>
				</Tooltip>
			</div>
			<div className="relative min-h-0 flex-1">
				<iframe
					// Keyed on the epoch alone: only Back / Forward / Reload remount.
					// Keying on observed navigation would reload `frame.path` on every
					// in-frame click and bounce the user back to the starting page.
					key={frame.epoch}
					ref={frameRef}
					title={title}
					src={frameSrc || undefined}
					sandbox={live || !proxied ? SANDBOX : undefined}
					referrerPolicy="no-referrer"
					className={cn(
						"absolute inset-0 block h-full w-full border-0 bg-background",
						dragShield && "pointer-events-none",
					)}
					style={{ colorScheme: "light dark" }}
				/>
			</div>
		</div>
	);
}
