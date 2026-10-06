"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
	createContext,
	memo,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { prepareAgentMessageMarkdown } from "@/lib/agent/message-markdown";
import { cn } from "@/lib/core/utils";

import { AgentCitationLink } from "./agent-citation-link";
import { PlainCodeBlock } from "./plain-code-block";
import { PlainTable } from "./plain-table";
import { Shimmer } from "./shimmer";

interface ReasoningContextValue {
	isStreaming: boolean;
	isOpen: boolean;
	setIsOpen: (open: boolean) => void;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
	const context = useContext(ReasoningContext);
	if (!context) {
		throw new Error("Reasoning components must be used within Reasoning");
	}
	return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
	isStreaming?: boolean;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

const AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(
	({
		className,
		isStreaming = false,
		open,
		defaultOpen,
		onOpenChange,
		children,
		...props
	}: ReasoningProps) => {
		const resolvedDefaultOpen = defaultOpen ?? isStreaming;
		// Track if defaultOpen was explicitly set to false (to prevent auto-open)
		const isExplicitlyClosed = defaultOpen === false;

		const [isOpen, setIsOpen] = useControllableState<boolean>({
			defaultProp: resolvedDefaultOpen,
			onChange: onOpenChange,
			prop: open,
		});

		const hasEverStreamedRef = useRef(isStreaming);
		const [hasAutoClosed, setHasAutoClosed] = useState(false);

		useEffect(() => {
			if (isStreaming) {
				hasEverStreamedRef.current = true;
			}
		}, [isStreaming]);

		// Auto-open when streaming starts (unless explicitly closed)
		useEffect(() => {
			if (isStreaming && !isOpen && !isExplicitlyClosed) {
				setIsOpen(true);
			}
		}, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

		// Auto-close when streaming ends (once only, and only if it ever streamed)
		useEffect(() => {
			if (
				hasEverStreamedRef.current &&
				!isStreaming &&
				isOpen &&
				!hasAutoClosed
			) {
				const timer = setTimeout(() => {
					setIsOpen(false);
					setHasAutoClosed(true);
				}, AUTO_CLOSE_DELAY);

				return () => clearTimeout(timer);
			}
		}, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

		const handleOpenChange = useCallback(
			(newOpen: boolean) => {
				setIsOpen(newOpen);
			},
			[setIsOpen],
		);

		const contextValue = useMemo(
			() => ({ isOpen, isStreaming, setIsOpen }),
			[isOpen, isStreaming, setIsOpen],
		);

		return (
			<ReasoningContext.Provider value={contextValue}>
				<Collapsible
					className={cn("not-prose mb-4", className)}
					onOpenChange={handleOpenChange}
					open={isOpen}
					{...props}
				>
					{children}
				</Collapsible>
			</ReasoningContext.Provider>
		);
	},
);

export type ReasoningTriggerProps = ComponentProps<
	typeof CollapsibleTrigger
> & {
	getThinkingMessage?: (isStreaming: boolean) => ReactNode;
	swapIconOnHover?: boolean;
};

export const ReasoningTrigger = memo(
	({
		className,
		children,
		getThinkingMessage,
		swapIconOnHover = false,
		...props
	}: ReasoningTriggerProps) => {
		const { t } = useTranslation("aiElements");
		const { isStreaming, isOpen } = useReasoning();

		// Durations are never persisted (ACP replay has no timestamps), so the
		// label is two-state only: streaming shimmer vs. a static header.
		const defaultGetThinkingMessage = (streaming: boolean) => {
			if (streaming) {
				return <Shimmer duration={1}>{t("reasoning.thinking")}</Shimmer>;
			}
			return <span>{t("reasoning.thought")}</span>;
		};

		const renderThinkingMessage =
			getThinkingMessage ?? defaultGetThinkingMessage;

		return (
			<CollapsibleTrigger
				className={cn(
					"flex w-full items-center justify-start gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground",
					swapIconOnHover && "group/reasoning-trigger",
					className,
				)}
				{...props}
			>
				{children ??
					(swapIconOnHover ? (
						<>
							<span className="relative flex size-4 shrink-0 items-center justify-center">
								<ChevronDownIcon
									className={cn(
										"absolute size-4 text-muted-foreground opacity-0 transition-all",
										"group-hover/reasoning-trigger:opacity-100",
										"-rotate-90 group-data-[state=open]/reasoning-trigger:rotate-0",
									)}
								/>
								<BrainIcon
									className={cn(
										"absolute size-4 text-muted-foreground transition-opacity",
										"group-hover/reasoning-trigger:opacity-0",
									)}
								/>
							</span>
							<span className="min-w-0 truncate font-medium text-xs">
								{renderThinkingMessage(isStreaming)}
							</span>
						</>
					) : (
						<>
							<BrainIcon className="size-4" />
							<span className="min-w-0 truncate font-medium text-xs">
								{renderThinkingMessage(isStreaming)}
							</span>
							<ChevronDownIcon
								className={cn(
									"size-4 transition-transform",
									isOpen ? "rotate-180" : "rotate-0",
								)}
							/>
						</>
					))}
			</CollapsibleTrigger>
		);
	},
);

export type ReasoningContentProps = ComponentProps<
	typeof CollapsibleContent
> & {
	children: string;
	/** Open a vault-relative source path from an inline citation pill. */
	onOpenSource?: (source: string) => void;
};

const streamdownPlugins = { cjk, code, math, mermaid };

export const ReasoningContent = memo(
	({ className, children, onOpenSource, ...props }: ReasoningContentProps) => (
		<CollapsibleContent
			className={cn(
				"mt-4 text-sm",
				"[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5",
				"data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
				className,
			)}
			{...props}
		>
			<Streamdown
				components={{
					a: (linkProps) => (
						<AgentCitationLink {...linkProps} onOpenSource={onOpenSource} />
					),
					code: PlainCodeBlock,
					table: PlainTable,
				}}
				linkSafety={{ enabled: false }}
				plugins={streamdownPlugins}
			>
				{prepareAgentMessageMarkdown(children)}
			</Streamdown>
		</CollapsibleContent>
	),
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
