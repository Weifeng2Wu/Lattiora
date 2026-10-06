import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SelectionCopiedLabel } from "@/components/ui/selection-copied-label";
import { AskPopover } from "@/components/viewer/pdf/cards/ask-popover";
import { SelectionMenu } from "@/components/viewer/pdf/cards/selection-menu";
import { TranslateCard } from "@/components/viewer/pdf/cards/translate-card";
import { useWebViewSelection } from "@/components/viewer/web-view/use-web-view-selection";
import { cloudAiError } from "@/lib/cloud/ai";
import { cacheHtmlPreview, loadHtmlPage } from "@/lib/cloud/html-reader";
import { notifyError } from "@/lib/core/notify";
import { openExternalUrl } from "@/lib/core/open-external";
import { cn } from "@/lib/core/utils";

type HtmlViewerProps = {
	/** Public remote HTML, cached locally and rendered in an opaque sandbox */
	srcUrl?: string | null;
	/** Paper title for ask-card / prompt context. */
	title?: string;
	className?: string;
};

/** Load-state of the built-in proxy for one paper host. */
type ProxyGate = "pending" | "ready" | "denied";

/**
 * HTML paper viewer — remote page in a sandboxed iframe.
 * Public HTML is cached for offline reading; website scripts cannot run.
 *
 * The original selection toolbar uses a trusted bridge inside an opaque frame.
 */
export function HtmlViewer({ srcUrl, title, className }: HtmlViewerProps) {
	const { t } = useTranslation(["viewer", "sidebar"]);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	/** While HTML5 DnD is active, disable iframe hit-testing so dragover
	 * reaches dockview drop targets (sandboxed iframe swallows drag events). */
	const [dragShield, setDragShield] = useState(false);
	const [gate, setGate] = useState<ProxyGate>("pending");

	useEffect(() => {
		const arm = () => setDragShield(true);
		const disarm = () => setDragShield(false);
		// Capture phase: see tree/OS drags before the event enters the iframe.
		window.addEventListener("dragstart", arm, true);
		window.addEventListener("dragend", disarm, true);
		window.addEventListener("drop", disarm, true);
		return () => {
			window.removeEventListener("dragstart", arm, true);
			window.removeEventListener("dragend", disarm, true);
			window.removeEventListener("drop", disarm, true);
		};
	}, []);

	const remote = srcUrl && /^https?:\/\//i.test(srcUrl) ? srcUrl : null;
	const [pageUrl, setPageUrl] = useState(remote);
	const [documentHtml, setDocumentHtml] = useState<string | null>(null);
	useEffect(() => setPageUrl(remote), [remote]);

	useEffect(() => {
		if (!pageUrl) return;
		const controller = new AbortController();
		let release: (() => Promise<boolean>) | undefined;
		setGate("pending");
		setDocumentHtml(null);
		void loadHtmlPage(pageUrl, controller.signal)
			.then((page) => {
				if (controller.signal.aborted) return;
				return cacheHtmlPreview(page, controller.signal).then((preview) => {
					if (controller.signal.aborted) {
						void preview.release();
						return;
					}
					release = preview.release;
					setDocumentHtml(preview.url);
					setGate("ready");
				});
			})
			.catch((error) => {
				if (controller.signal.aborted) return;
				setGate("denied");
				notifyError(cloudAiError(error));
			});
		return () => {
			controller.abort();
			void release?.();
		};
	}, [pageUrl]);
	useEffect(() => {
		const navigate = (event: MessageEvent) => {
			if (
				event.source !== iframeRef.current?.contentWindow ||
				event.origin !== "null" ||
				event.data?.source !== "agentero-web" ||
				event.data?.type !== "navigate"
			)
				return;
			try {
				const target = new URL(event.data.url);
				if (pageUrl && target.origin === new URL(pageUrl).origin)
					setPageUrl(target.href);
			} catch {
				/* Ignore malformed frame messages. */
			}
		};
		window.addEventListener("message", navigate);
		return () => window.removeEventListener("message", navigate);
	}, [pageUrl]);

	const selection = useWebViewSelection({
		srcUrl: pageUrl ?? "",
		iframeRef,
		title,
	});

	if (!remote) {
		return (
			<div
				className={cn(
					"flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm",
					className,
				)}
			>
				{t("html.empty")}
			</div>
		);
	}

	return (
		<div
			className={cn(
				"relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-background",
				className,
			)}
		>
			{documentHtml ? (
				// The cached response enforces CSP sandbox before parsing. An iframe
				// sandbox attribute would bypass Service Worker interception in Chromium.
				<iframe
					title={t("html.sandboxTitle")}
					src={documentHtml}
					referrerPolicy="no-referrer"
					ref={iframeRef}
					className={cn(
						"absolute inset-0 block h-full w-full border-0 bg-background",
						dragShield && "pointer-events-none",
					)}
					style={{ colorScheme: "light dark" }}
				/>
			) : (
				<div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm">
					{gate === "denied" ? (
						<div className="flex items-center gap-2">
							<span>{t("html.denied")}</span>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("sidebar:plaza.openInSystemBrowser")}
								onClick={() => openExternalUrl(pageUrl || remote)}
							>
								<ExternalLink className="size-4" />
							</Button>
						</div>
					) : null}
				</div>
			)}
			{documentHtml
				? createPortal(
						<>
							{selection.menu && !selection.ask ? (
								<SelectionMenu
									screen={selection.menu.screen}
									onHighlight={() => undefined}
									onAsk={selection.handleAsk}
									onAddToChat={selection.handleAddToChat}
									onTranslate={selection.handleTranslate}
									showHighlight={false}
								/>
							) : null}
							{selection.copiedLabelPos ? (
								<SelectionCopiedLabel
									x={selection.copiedLabelPos.x}
									y={selection.copiedLabelPos.y}
								/>
							) : null}
							{selection.ask ? (
								<AskPopover
									thread={selection.ask.thread}
									paperTitle={title}
									paperLink={remote}
									screen={selection.ask.screen}
									streaming={selection.streaming}
									error={selection.askError}
									onSend={selection.sendAskQuestion}
									onResend={selection.resendAskQuestion}
									onHide={selection.hideAsk}
									onDelete={selection.deleteAsk}
									onStop={selection.stopAskStreaming}
								/>
							) : null}
							{selection.translateRec && selection.translateScreen ? (
								<TranslateCard
									screen={selection.translateScreen}
									result={selection.translateRec.result ?? ""}
									streaming={selection.translateStreaming}
									error={
										selection.translateError ??
										selection.translateRec.error ??
										null
									}
									onOpenSettings={selection.openTranslateSettings}
									onHide={selection.hideTranslate}
									onDelete={selection.deleteTranslateCard}
								/>
							) : null}
						</>,
						document.body,
					)
				: null}
		</div>
	);
}
