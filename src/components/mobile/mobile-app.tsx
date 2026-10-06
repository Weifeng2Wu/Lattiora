import { ArrowLeft, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { CLOUD_ROOT } from "@/lib/cloud/protocol";
import { libraryStore } from "@/lib/paper/library-store";
import type { PaperMetadata } from "@/lib/paper/types";
import { openSettingsWindow } from "@/lib/shell/settings-window";
import { setHomeOpen, uiStore } from "@/lib/shell/ui-store";
import { MobileSidebar } from "./mobile-sidebar";

export default function MobileApp() {
	useAppBootstrap();
	const beforeLeave = useRef<(() => Promise<boolean>) | null>(null);
	const { t } = useTranslation("mobile");
	const [tab, setTab] = useState<MobileTab>(() =>
		uiStore.getState().homeOpen ? "home" : "library",
	);
	const [libraryQuery, setLibraryQuery] = useState("");
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [selectedPaper, setSelectedPaper] = useState<PaperMetadata | null>(
		null,
	);
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
			setTab(next);
			setHomeOpen(next === "home");
		})();
	};

	const swipeHandlers = useHorizontalSwipe(
		({ dx, dy, fromEdge, durationMs }) => {
			if (sidebarOpen || selectedPaper) return;
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

	const inReader = tab === "library" && selectedPaper !== null;

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
					title={inReader ? selectedPaper.title : t(`tabs.${tab}`)}
					status={status}
					statusLabel={
						connected ? t("settings.connected") : t("settings.offline")
					}
					brand={<MobileBrand />}
					brandButtonLabel={t("settings.menu")}
					onBrandClick={() => setSidebarOpen(true)}
					showBrand={!selectedPaper}
					leading={
						inReader ? (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={t("reader.back")}
								onClick={closeReader}
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
						) : tab === "library" ? (
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
				<CloudToolbar onHome={() => changeTab("home")} />
				<div className="min-h-0 flex-1 overflow-hidden">
					{tab === "home" && <HomePage onBack={() => changeTab("library")} />}
					{tab === "library" ? (
						selectedPaper ? (
							<EdgeSwipeBack onBack={closeReader}>
								<MobileReaderPage
									key={selectedPaper.path}
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
							onOpenSource={(source) => {
								const paper = papers.find(
									(paper) =>
										paper.path &&
										(source === paper.path ||
											source.startsWith(`${paper.path}/`)),
								);
								if (paper) {
									setSelectedPaper(paper);
									setReaderMode("pdf");
									setTab("library");
								}
							}}
						/>
					) : null}
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
