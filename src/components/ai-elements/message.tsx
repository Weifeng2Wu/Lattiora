"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { prepareAgentMessageMarkdown } from "@/lib/agent/message-markdown";
import { cn } from "@/lib/core/utils";

import { AgentCitationLink } from "./agent-citation-link";
import { PlainCodeBlock } from "./plain-code-block";
import { PlainTable } from "./plain-table";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
	<div
		className={cn(
			"group flex w-full max-w-[95%] flex-col gap-2",
			from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
			className,
		)}
		{...props}
	/>
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
	children,
	className,
	...props
}: MessageContentProps) => (
	<div
		className={cn(
			"flex w-fit min-w-0 max-w-full select-text flex-col gap-2 overflow-hidden text-sm",
			"group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-black/5 group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground dark:group-[.is-user]:bg-white/10",
			"group-[.is-assistant]:text-foreground",
			className,
		)}
		{...props}
	>
		{children}
	</div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
	className,
	children,
	...props
}: MessageActionsProps) => (
	<div className={cn("flex items-center gap-1", className)} {...props}>
		{children}
	</div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
	tooltip?: string;
	label?: string;
};

export const MessageAction = ({
	tooltip,
	children,
	label,
	variant = "ghost",
	size = "icon-sm",
	...props
}: MessageActionProps) => {
	const button = (
		<Button size={size} type="button" variant={variant} {...props}>
			{children}
			<span className="sr-only">{label || tooltip}</span>
		</Button>
	);

	if (tooltip) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>{button}</TooltipTrigger>
					<TooltipContent>
						<p>{tooltip}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	}

	return button;
};

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
	/** Open a vault-relative source path from an inline citation pill. */
	onOpenSource?: (source: string) => void;
};

/**
 * KaTeX via Streamdown. Default `@streamdown/math` turns single-dollar off
 * (`singleDollarTextMath: false`), so common agent math like `$\pi_\theta$`
 * rendered as raw text. Enable `$…$` for inline and keep `$$…$$` for display.
 */
const streamdownMath = createMathPlugin({ singleDollarTextMath: true });
const streamdownPlugins = {
	cjk,
	code,
	math: streamdownMath,
	mermaid,
};

export const MessageResponse = memo(
	({ className, children, onOpenSource, ...props }: MessageResponseProps) => {
		const content =
			typeof children === "string"
				? prepareAgentMessageMarkdown(children)
				: children;
		return (
			<Streamdown
				// Streamdown's default `mode="streaming"` runs `remend` on every
				// render. remend truncates a TeX `<` comparison (`x_{<n}`) as an
				// unclosed HTML tag, so KaTeX gets `…x_{` and fails (#584). That
				// repair only makes sense while text is still arriving; settled
				// messages render statically with the math source intact.
				mode={props.isAnimating ? "streaming" : "static"}
				className={cn(
					// Keep the renderer's height content-driven. `size-full` sets
					// height: 100%, which can clip later blocks in auto-sized embeds.
					"w-full min-w-0 select-text text-base leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
					className,
				)}
				components={{
					a: (linkProps) => (
						<AgentCitationLink {...linkProps} onOpenSource={onOpenSource} />
					),
					code: PlainCodeBlock,
					table: PlainTable,
				}}
				linkSafety={{ enabled: false }}
				plugins={streamdownPlugins}
				{...props}
			>
				{content}
			</Streamdown>
		);
	},
	(prevProps, nextProps) =>
		prevProps.children === nextProps.children &&
		nextProps.isAnimating === prevProps.isAnimating &&
		prevProps.onOpenSource === nextProps.onOpenSource,
);

MessageResponse.displayName = "MessageResponse";
