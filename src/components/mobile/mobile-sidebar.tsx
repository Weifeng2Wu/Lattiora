import { Monitor, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import lattioraIcon from "@/assets/lattiora-icon.svg";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/core/utils";
import { useHorizontalSwipe } from "./mobile-gestures";
import { MobileNav, type MobileTab } from "./mobile-nav";

/** Original drawer layout; web login replaces native host pairing. */
export function MobileSidebar({
	open,
	onClose,
	tab,
	onTab,
}: {
	open: boolean;
	onClose: () => void;
	tab: MobileTab;
	onTab: (tab: MobileTab) => void;
}) {
	const { t } = useTranslation(["mobile", "common"]);
	const swipe = useHorizontalSwipe(({ dx, dy }) => {
		if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.25) onClose();
	});
	useEffect(() => {
		if (!open) return;
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [open, onClose]);
	return (
		<div
			className={cn(
				"fixed inset-0 z-40 transition-[visibility] duration-200",
				open ? "visible" : "invisible",
			)}
			aria-hidden={!open}
			inert={!open}
		>
			<button
				type="button"
				className={cn(
					"absolute inset-0 bg-black/30 transition-opacity duration-200 ease-out",
					open ? "opacity-100" : "opacity-0",
				)}
				aria-label={t("settings.closeMenu")}
				onClick={onClose}
			/>
			<aside
				className={cn(
					"absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] select-none flex-col border-r bg-background pt-[env(safe-area-inset-top)] shadow-xl transition-transform duration-200 ease-out",
					open ? "translate-x-0" : "-translate-x-full",
				)}
				aria-label={t("settings.menu")}
				{...swipe}
			>
				<header className="flex h-16 shrink-0 items-center justify-between border-b px-4">
					<div className="flex items-center gap-2">
						<img src={lattioraIcon} alt="" className="size-8" />
						<span className="font-semibold text-base">
							{t("common:brand.name")}
						</span>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("settings.closeMenu")}
						onClick={onClose}
					>
						<X className="size-4" />
					</Button>
				</header>
				<div className="flex-1 overflow-y-auto px-4 py-5">
					<MobileNav
						tab={tab}
						onTab={onTab}
						variant="sidebar"
						agentTemplate="builtin"
					/>
				</div>
				<footer className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
					<Button
						className="h-12 w-full justify-start gap-3 rounded-xl px-3 text-base"
						onClick={() => {
							const url = new URL(location.href);
							url.searchParams.set("view", "desktop");
							location.assign(url.href);
						}}
					>
						<Monitor className="size-5" />
						{t("settings.desktopView")}
					</Button>
				</footer>
			</aside>
		</div>
	);
}
