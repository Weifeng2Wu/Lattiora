import { ArrowUpRight, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cloudAiError } from "@/lib/cloud/ai";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import {
	CAPTURE_ROOT,
	recentQuickCaptures,
	saveQuickCapture,
} from "@/lib/cloud/quick-capture";
import { notifyError } from "@/lib/core/notify";
import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";

const DRAFT_KEY = "lattiora-capture-draft";
export function HomeCapture({
	onOpenFile,
}: {
	onOpenFile?: (path: string) => void;
}) {
	const { t } = useTranslation("app");
	const [draft, setDraft] = useState(() =>
		readJsonStorage<string>(DRAFT_KEY, ""),
	);
	const [items, setItems] = useState<
		Awaited<ReturnType<typeof recentQuickCaptures>>
	>([]);
	const [busy, setBusy] = useState(false);
	const saving = useRef(false);
	const input = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		let active = true,
			generation = 0;
		const refresh = async () => {
			const request = ++generation;
			try {
				const next = await recentQuickCaptures();
				if (active && request === generation) setItems(next);
			} catch (error) {
				if (active) notifyError(cloudAiError(error));
			}
		};
		void refresh();
		const unsubscribe = subscribeCloudFiles((paths) => {
			if (paths.some((path) => path.startsWith(CAPTURE_ROOT))) void refresh();
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);
	const change = (text: string) => {
		setDraft(text);
		writeJsonStorage(DRAFT_KEY, text);
	};
	const save = async () => {
		if (saving.current || !draft.trim()) return;
		saving.current = true;
		setBusy(true);
		try {
			await saveQuickCapture(draft);
			change("");
			requestAnimationFrame(() => input.current?.focus());
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			saving.current = false;
			setBusy(false);
		}
	};
	return (
		<section
			className="h-full space-y-3 rounded-xl border bg-card/90 p-5"
			aria-label={t("home.widgets.capture")}
		>
			<h2 className="text-sm font-medium">{t("home.widgets.capture")}</h2>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<Textarea
					ref={input}
					aria-label={t("home.capture.placeholder")}
					placeholder={t("home.capture.placeholder")}
					value={draft}
					maxLength={10000}
					disabled={busy}
					className="min-h-24 max-h-64 min-w-0 resize-y bg-background/70"
					onChange={(event) => change(event.target.value)}
					onKeyDown={(event) => {
						if (
							!event.nativeEvent.isComposing &&
							event.key === "Enter" &&
							(event.ctrlKey || event.metaKey)
						) {
							event.preventDefault();
							void save();
						}
					}}
				/>
				<div className="mt-2 flex justify-end">
					<Button
						type="submit"
						size="icon-sm"
						disabled={busy || !draft.trim()}
						aria-label={t("home.capture.save")}
						title={`${t("home.capture.save")} (Ctrl/⌘+Enter)`}
						aria-keyshortcuts="Control+Enter Meta+Enter"
					>
						<Send className="size-4" />
					</Button>
				</div>
			</form>
			<ul className="divide-y">
				{items.map((item) => (
					<li key={item.path}>
						<button
							type="button"
							className="flex w-full items-center gap-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
							disabled={!onOpenFile}
							onClick={() => onOpenFile?.(item.path)}
						>
							<span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">
								{item.text}
							</span>
							<ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
