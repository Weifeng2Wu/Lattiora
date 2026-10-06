import { ArrowLeft, Search } from "lucide-react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import lattioraIcon from "@/assets/lattiora-icon.svg";
import { AgentPanel } from "@/components/agent/agent-panel";
import { CloudToolbar } from "@/components/cloud/cloud-toolbar";
import { HomePage } from "@/components/home/home-page";
import {
	EdgeSwipeBack,
	useHorizontalSwipe,
} from "@/components/mobile/mobile-gestures";
import { MobileHeader } from "@/components/mobile/mobile-header";
import { MobileReaderModeToggle } from "@/components/mobile/mobile-header-actions";
import { MobileLibraryPage } from "@/components/mobile/mobile-library-page";
import { MobileNav, type MobileTab } from "@/components/mobile/mobile-nav";
import { MobileReaderPage } from "@/components/mobile/mobile-reader-page";
import type { MobileReaderMode } from "@/components/mobile/types";
import { OnboardingRoot } from "@/components/onboarding/onboarding-root";
import { AppDialogs } from "@/components/shell/app-dialogs";
import { BackgroundTasksPanel } from "@/components/shell/background-tasks-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppBootstrap } from "@/hooks/use-app-bootstrap";
import { cloudAiError } from "@/lib/cloud/ai";
import {
	absoluteCloudPath,
	cloudRelative,
	readLocalFile,
} from "@/lib/cloud/files";
import { CLOUD_ROOT } from "@/lib/cloud/protocol";
import { notifyError } from "@/lib/core/notify";
import { libraryStore } from "@/lib/paper/library-store";
import type { PaperMetadata } from "@/lib/paper/types";
import { setPendingPdfPage } from "@/lib/pdf/pending-pdf-page";
import { openSettingsWindow } from "@/lib/shell/settings-window";
import { setHomeOpen, uiStore } from "@/lib/shell/ui-store";
import { MobileSidebar } from "./mobile-sidebar";

const GraphView = lazy(() =>
	import("@/components/research/graph-view").then((m) => ({
		default: m.GraphView,
	})),
);
const SemanticSearchView = lazy(() =>
	import("@/components/research/semantic-search-view").then((m) => ({
		default: m.SemanticSearchView,
	})),
);

export default function MobileApp() {
	useAppBootstrap();
	const beforeLeave = useRef<(() => Promise<boolean>) | null>(null);
	const { t } = useTranslation(["mobile", "app"]);
	const [tab, setTab] = useState<MobileTab>(() =>
		uiStore.getState().homeOpen ? "home" : "library",
	);
	const [libraryQuery, setLibraryQuery] = useState("");
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [selectedPaper, setSelectedPaper] = useState<PaperMetadata | null>(
		null,
	);
	const [research, setResearch] = useState<"graph" | "semantic-search" | null>(
		null,
	);
	const [source, setSource] = useState<string | null>(null);
	const [readerRevision, setReaderRevision] = useState(0);
	const [readerMode, setReaderMode] = useState<MobileReaderMode>("pdf");
	const papers = useStore(libraryStore, (state) => state.papers);
	const papersLoading = useStore(libraryStore, (state) => state.loading);
	const [connected, setConnected] = useState(navigator.onLine);
	useEffect(() => {
		const update = () => setConnected(navigator.onLine);
		window.addEventListener("online", update);
		window.addEventListener("offline", update);
		return () => {
			window.removeEventListener("online", update);
			window.removeEventListener("offline", update);
		};
	}, []);
	const status = { connected };
	const closeReader = useCallback(() => {
		void (async () => {
			if (beforeLeave.current && !(await beforeLeave.current())) return;
			setSelectedPaper(null);
			setReaderMode("pdf");
		})();
	}, []);
	const changeTab = (next: MobileTab) => {
		void (async () => {
			if (beforeLeave.current && !(await beforeLeave.current())) return;
			setResearch(null);
			setSource(null);
			setTab(next);
			setHomeOpen(next === "home");
		})();
	};

	const openResearch = (next: "graph" | "semantic-search") => {
		void (async () => {
			if (beforeLeave.current && !(await beforeLeave.current())) return;
			setSource(null);
			setResearch(next);
		})();
	};
	const openSource = (target: string) => {
		void (async () => {
			if (beforeLeave.current && !(await beforeLeave.current())) return;
			const [raw, fragment = ""] = target.split("#");
			const path = cloudRelative(raw);
			const paper = papers.find(
				(item) =>
					item.path && (path === item.path || path.startsWith(`${item.path}/`)),
			);
			if (paper?.path) {
				const page = Number(new URLSearchParams(fragment).get("page"));
				if (page > 0)
					setPendingPdfPage([paper.path, absoluteCloudPath(paper.path)], page);
				setReaderRevision((n) => n + 1);
				setSelectedPaper(paper);
				setReaderMode(path.endsWith("/NOTES.md") ? "notes" : "pdf");
				setResearch(null);
				setSource(null);
				setTab("library");
				setHomeOpen(false);
			} else setSource(path);
		})();
	};
	const closeResearch = () => {
		if (source) setSource(null);
		else setResearch(null);
	};
	const swipeHandlers = useHorizontalSwipe(
		({ dx, dy, fromEdge, durationMs }) => {
			if (sidebarOpen || selectedPaper || research || source) return;
			if (durationMs > 500 || Math.abs(dy) > 60) return;
			const horizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
			if (!horizontal) return;
			if (dx > 60 && fromEdge) {
				setSidebarOpen(true);
				return;
			}
			if (dx < -60 && tab === "library") {
				setTab("agent");
				return;
			}
			if (dx > 60 && tab === "agent") {
				setTab("library");
			}
		},
	);

	const inReader =
		!research && !source && tab === "library" && selectedPaper !== null;

	return (
		<div
			className="mobile-shell flex h-dvh min-h-0 overflow-hidden bg-background text-foreground"
			{...swipeHandlers}
		>
			<aside className="hidden w-20 shrink-0 flex-col items-center border-r bg-muted/25 py-6 md:flex">
				<MobileBrand />
				<MobileNav tab={tab} onTab={changeTab} agentTemplate="builtin" />
			</aside>
			<main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
				<MobileHeader
					title={
						source ??
						(research
							? t(`app:research.${research}.title`)
							: inReader
								? selectedPaper.title
								: t(`tabs.${tab}`))
					}
					status={status}
					statusLabel={
						connected ? t("settings.connected") : t("settings.offline")
					}
					brand={<MobileBrand />}
					brandButtonLabel={t("settings.menu")}
					onBrandClick={() => setSidebarOpen(true)}
					showBrand={!selectedPaper && !research && !source}
					leading={
						inReader || research || source ? (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={t("reader.back")}
								onClick={research || source ? closeResearch : closeReader}
							>
								<ArrowLeft className="size-4" />
							</Button>
						) : undefined
					}
					trailing={
						inReader ? (
							<MobileReaderModeToggle
								mode={readerMode}
								onChange={setReaderMode}
							/>
						) : !research && !source && tab === "library" ? (
							<div className="relative w-[min(10rem,38vw)] shrink-0">
								<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={libraryQuery}
									onChange={(event) => setLibraryQuery(event.target.value)}
									placeholder={t("library.search")}
									aria-label={t("library.search")}
									className="h-10 w-full pl-8 text-base md:text-sm"
								/>
							</div>
						) : null
					}
				/>
				<div className="h-16 shrink-0 md:hidden" aria-hidden="true" />
				<CloudToolbar
					onHome={() => changeTab("home")}
					onGraph={() => openResearch("graph")}
					onSearch={() => openResearch("semantic-search")}
				/>
				<div className="min-h-0 flex-1 overflow-hidden">
					{source ? (
						<MobileSource path={source} />
					) : research ? (
						<Suspense fallback={null}>
							{research === "graph" ? (
								<GraphView onOpenFile={openSource} />
							) : (
								<SemanticSearchView onOpenFile={openSource} />
							)}
						</Suspense>
					) : (
						<>
							{tab === "home" && (
								<HomePage
									onBack={() => changeTab("library")}
									onOpenFile={openSource}
								/>
							)}
							{tab === "library" ? (
								selectedPaper ? (
									<EdgeSwipeBack onBack={closeReader}>
										<MobileReaderPage
											key={`${selectedPaper.path}:${readerRevision}`}
											paper={selectedPaper}
											mode={readerMode}
											beforeLeave={beforeLeave}
										/>
									</EdgeSwipeBack>
								) : (
									<MobileLibraryPage
										papers={papers}
										loading={papersLoading}
										selected={selectedPaper}
										onSelect={setSelectedPaper}
										query={libraryQuery}
									/>
								)
							) : null}
							{tab === "agent" ? (
								<AgentPanel
									vaultPath={CLOUD_ROOT}
									selectedPath={selectedPaper?.path}
									selectedPaperTitle={selectedPaper?.title}
									onOpenAgentSettings={openSettingsWindow}
									className="h-full"
									onOpenSource={openSource}
								/>
							) : null}
						</>
					)}
				</div>
			</main>
			<MobileSidebar
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
				tab={tab}
				onTab={(next) => {
					changeTab(next);
					setSidebarOpen(false);
				}}
			/>
			<AppDialogs />
			<OnboardingRoot />
			<BackgroundTasksPanel />
		</div>
	);
}

function MobileBrand() {
	const { t } = useTranslation("common");
	return <img src={lattioraIcon} alt={t("brand.name")} className="size-8" />;
}

function MobileSource({ path }: { path: string }) {
	const [text, setText] = useState("");
	useEffect(() => {
		let active = true;
		setText("");
		void readLocalFile(path)
			.then((file) => file.text())
			.then((value) => {
				if (active) setText(value);
			})
			.catch((error) => {
				if (active) notifyError(cloudAiError(error));
			});
		return () => {
			active = false;
		};
	}, [path]);
	return (
		<pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 text-sm">
			{text}
		</pre>
	);
}
