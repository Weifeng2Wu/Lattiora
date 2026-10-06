"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
	CheckCircleIcon,
	ChevronDownIcon,
	CircleIcon,
	ClockIcon,
	WrenchIcon,
	XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/core/utils";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
	<Collapsible
		className={cn(
			"group not-prose mb-1.5 w-full max-w-full rounded border bg-muted/20",
			className,
		)}
		{...props}
	/>
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
	title?: string;
	className?: string;
	swapIconOnHover?: boolean;
} & (
	| { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
	| {
			type: DynamicToolUIPart["type"];
			state: DynamicToolUIPart["state"];
			toolName: string;
	  }
);

const statusLabelKeys = {
	"approval-requested": "tool.status.awaitingApproval",
	"approval-responded": "tool.status.responded",
	"input-available": "tool.status.running",
	"input-streaming": "tool.status.pending",
	"output-available": "tool.status.completed",
	"output-denied": "tool.status.denied",
	"output-error": "tool.status.error",
} as const satisfies Record<ToolPart["state"], string>;

const statusIcons: Record<ToolPart["state"], ReactNode> = {
	"approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
	"approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
	"input-available": <ClockIcon className="size-4 animate-pulse" />,
	"input-streaming": <CircleIcon className="size-4" />,
	"output-available": (
		<CheckCircleIcon className="size-4 text-muted-foreground" />
	),
	"output-denied": <XCircleIcon className="size-4 text-orange-600" />,
	"output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"], label: string) => (
	<Badge
		className="h-5 gap-1 rounded-full bg-black/5 px-1.5 py-0 text-caption font-normal text-foreground dark:bg-white/10"
		variant="secondary"
	>
		<span className="[&>svg]:size-3">{statusIcons[status]}</span>
		{label}
	</Badge>
);

export const ToolHeader = ({
	className,
	title,
	type,
	state,
	toolName,
	swapIconOnHover = false,
	...props
}: ToolHeaderProps) => {
	const { t } = useTranslation("aiElements");
	const derivedName =
		type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

	return (
		<CollapsibleTrigger
			className={cn(
				// Left-aligned compact header (not space-between)
				"flex w-full items-center justify-start gap-2 px-2 py-1 text-left text-muted-foreground transition-colors hover:text-foreground",
				swapIconOnHover && "group/tool-header",
				className,
			)}
			{...props}
		>
			{swapIconOnHover ? (
				<span className="relative flex size-4 shrink-0 items-center justify-center">
					<ChevronDownIcon
						className={cn(
							"absolute size-4 text-muted-foreground opacity-0 transition-all",
							"group-hover/tool-header:opacity-100",
							"-rotate-90 group-data-[state=open]:rotate-0",
						)}
					/>
					<WrenchIcon
						className={cn(
							"absolute size-4 text-muted-foreground transition-opacity",
							"group-hover/tool-header:opacity-0",
						)}
					/>
				</span>
			) : (
				<>
					<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform -rotate-90 group-data-[state=open]:rotate-0" />
					<WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
				</>
			)}
			<span className="min-w-0 truncate font-medium text-xs">
				{title ?? derivedName}
			</span>
			{state === "output-denied" || state === "output-error" ? (
				<span className="ml-auto">
					{getStatusBadge(state, t(statusLabelKeys[state]))}
				</span>
			) : null}
		</CollapsibleTrigger>
	);
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
	<CollapsibleContent
		className={cn(
			"data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-2 border-t px-2 py-1.5 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
			className,
		)}
		{...props}
	/>
);

export type ToolInputProps = ComponentProps<"div"> & {
	input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
	const { t } = useTranslation("aiElements");

	return (
		<div className={cn("space-y-1 overflow-hidden", className)} {...props}>
			<h4 className="font-medium text-caption text-muted-foreground uppercase tracking-wide">
				{t("tool.parameters")}
			</h4>
			<div className="rounded bg-muted/50 text-xs">
				<CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
			</div>
		</div>
	);
};

export type ToolOutputProps = ComponentProps<"div"> & {
	output: ToolPart["output"];
	errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
	className,
	output,
	errorText,
	...props
}: ToolOutputProps) => {
	const { t } = useTranslation("aiElements");

	if (!(output || errorText)) {
		return null;
	}

	let Output = <div>{output as ReactNode}</div>;

	if (typeof output === "object" && !isValidElement(output)) {
		Output = (
			<CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
		);
	} else if (typeof output === "string") {
		Output = <CodeBlock code={output} language="json" />;
	}

	return (
		<div className={cn("space-y-1", className)} {...props}>
			<h4 className="font-medium text-caption text-muted-foreground uppercase tracking-wide">
				{errorText ? t("tool.error") : t("tool.result")}
			</h4>
			<div
				className={cn(
					"overflow-x-auto rounded text-caption [&_table]:w-full",
					errorText
						? "bg-destructive/10 text-destructive"
						: "bg-muted/50 text-foreground",
				)}
			>
				{errorText && <div className="px-1.5 py-1">{errorText}</div>}
				{Output}
			</div>
		</div>
	);
};
