import { History, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isSessionIdPrefixTitle } from "@/components/agent/hooks/use-agent-history";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatLine, ChatSessionHistoryItem } from "@/lib/agent/chat-state";
import { displayHistoryTitle } from "@/lib/agent/prompt-display";
import { cn } from "@/lib/core/utils";

export function HistorySessionList({
	sessionHistory,
	activeTabId,
	submitting,
	onOpen,
}: {
	sessionHistory: ChatSessionHistoryItem[];
	activeTabId: string;
	submitting: boolean;
	onOpen: (item: ChatSessionHistoryItem) => void;
}) {
	const { t } = useTranslation("agent");

	if (sessionHistory.length === 0) {
		return (
			<p className="px-3 py-4 text-muted-foreground text-sm leading-none">
				{t("history.empty")}
			</p>
		);
	}

	return (
		<div className="max-h-72 overflow-y-auto p-1.5">
			{sessionHistory.map((item) => {
				const isActive = item.id === activeTabId;
				const firstUserLine = item.lines.find(
					(line): line is Extract<ChatLine, { kind: "user" }> =>
						line.kind === "user",
				);
				// Ignore historical session-id placeholders so user-prompt
				// fallback / hydration can surface (#484, Kimi `ses_…`).
				const providerId = item.providerSessionId?.trim() || "";
				const storedTitle =
					isSessionIdPrefixTitle(item.title, item.id) ||
					(providerId !== "" && isSessionIdPrefixTitle(item.title, providerId))
						? ""
						: item.title;
				const label = displayHistoryTitle(
					storedTitle || firstUserLine?.text || "",
					item.id.slice(0, 8),
				);
				return (
					<button
						key={item.id}
						type="button"
						disabled={submitting}
						className={cn(
							"flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
							isActive
								? "bg-muted text-foreground"
								: "hover:bg-muted/70 focus-visible:bg-muted/70",
						)}
						onClick={() => onOpen(item)}
					>
						<span className="text-muted-foreground text-xs leading-none">
							{item.agentName} · {t(`history.status.${item.status}`)}
						</span>
						<span className="line-clamp-2 font-medium text-sm leading-snug">
							{label}
						</span>
						<span className="text-muted-foreground text-xs leading-none">
							{item.startedAt}
						</span>
					</button>
				);
			})}
		</div>
	);
}

/** Sidebar-mode header: new chat + history popover (+ optional actions). */
export function SidebarHistoryTrailing({
	historyOpen,
	onHistoryOpenChange,
	sessionHistory,
	activeTabId,
	submitting,
	headerActions,
	onNewConversation,
	onOpenSession,
}: {
	historyOpen: boolean;
	onHistoryOpenChange: (open: boolean) => void;
	sessionHistory: ChatSessionHistoryItem[];
	activeTabId: string;
	submitting: boolean;
	headerActions?: ReactNode;
	onNewConversation: () => void;
	onOpenSession: (item: ChatSessionHistoryItem) => void;
}) {
	const { t } = useTranslation("agent");

	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label={t("tabs.new")}
				title={t("tabs.new")}
				disabled={submitting}
				onClick={onNewConversation}
			>
				<Plus className="size-4" />
			</Button>
			<Popover open={historyOpen} onOpenChange={onHistoryOpenChange}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 gap-1 px-1.5 font-normal text-muted-foreground text-sm leading-none hover:text-foreground"
						aria-label={t("history.aria")}
						title={t("history.label")}
						disabled={submitting}
					>
						<History className="size-3.5" />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-80 p-0">
					<PopoverHeader className="border-b px-3 py-2">
						<PopoverTitle className="font-medium text-sm leading-none">
							{t("history.title")}
						</PopoverTitle>
						<PopoverDescription className="text-muted-foreground text-sm leading-snug">
							{t("history.description")}
						</PopoverDescription>
					</PopoverHeader>
					{sessionHistory.length === 0 ? (
						<div className="px-3 py-4 text-muted-foreground text-sm leading-none">
							{t("history.empty")}
						</div>
					) : (
						<HistorySessionList
							sessionHistory={sessionHistory}
							activeTabId={activeTabId}
							submitting={submitting}
							onOpen={onOpenSession}
						/>
					)}
				</PopoverContent>
			</Popover>
			{headerActions}
		</>
	);
}
