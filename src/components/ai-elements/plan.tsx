"use client";

import {
	CheckIcon,
	ChevronsUpDownIcon,
	CircleIcon,
	LoaderCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/core/utils";

import { Shimmer } from "./shimmer";

interface PlanContextValue {
	isStreaming: boolean;
}

const PlanContext = createContext<PlanContextValue | null>(null);

const usePlan = () => {
	const context = useContext(PlanContext);
	if (!context) {
		throw new Error("Plan components must be used within Plan");
	}
	return context;
};

export type PlanProps = ComponentProps<typeof Collapsible> & {
	isStreaming?: boolean;
};

export const Plan = ({
	className,
	isStreaming = false,
	children,
	...props
}: PlanProps) => {
	const contextValue = useMemo(() => ({ isStreaming }), [isStreaming]);

	return (
		<PlanContext.Provider value={contextValue}>
			<Collapsible asChild data-slot="plan" {...props}>
				<Card className={cn("shadow-none", className)}>{children}</Card>
			</Collapsible>
		</PlanContext.Provider>
	);
};

export type PlanHeaderProps = ComponentProps<typeof CardHeader>;

export const PlanHeader = ({ className, ...props }: PlanHeaderProps) => (
	<CardHeader
		className={cn("flex items-start justify-between", className)}
		data-slot="plan-header"
		{...props}
	/>
);

export type PlanTitleProps = Omit<
	ComponentProps<typeof CardTitle>,
	"children"
> & {
	children: string;
};

export const PlanTitle = ({ children, ...props }: PlanTitleProps) => {
	const { isStreaming } = usePlan();

	return (
		<CardTitle data-slot="plan-title" {...props}>
			{isStreaming ? <Shimmer>{children}</Shimmer> : children}
		</CardTitle>
	);
};

export type PlanDescriptionProps = Omit<
	ComponentProps<typeof CardDescription>,
	"children"
> & {
	children: string;
};

export const PlanDescription = ({
	className,
	children,
	...props
}: PlanDescriptionProps) => {
	const { isStreaming } = usePlan();

	return (
		<CardDescription
			className={cn("text-balance", className)}
			data-slot="plan-description"
			{...props}
		>
			{isStreaming ? <Shimmer>{children}</Shimmer> : children}
		</CardDescription>
	);
};

export type PlanActionProps = ComponentProps<typeof CardAction>;

export const PlanAction = (props: PlanActionProps) => (
	<CardAction data-slot="plan-action" {...props} />
);

export type PlanContentProps = ComponentProps<typeof CardContent>;

export const PlanContent = (props: PlanContentProps) => (
	<CollapsibleContent asChild>
		<CardContent data-slot="plan-content" {...props} />
	</CollapsibleContent>
);

export type PlanStepStatus = "pending" | "in_progress" | "completed";

export type PlanStepProps = ComponentProps<"li"> & {
	status?: PlanStepStatus;
	children: ReactNode;
};

export const PlanStep = ({
	className,
	status = "pending",
	children,
	...props
}: PlanStepProps) => {
	const { t } = useTranslation("aiElements");
	const statusLabel = t(`plan.status.${status}`);
	const isCompleted = status === "completed";

	return (
		<li
			className={cn(
				"flex min-w-0 items-start gap-2 text-sm",
				status === "in_progress" && "text-foreground",
				status === "pending" && "text-muted-foreground",
				status === "completed" && "text-muted-foreground",
				className,
			)}
			data-slot="plan-step"
			{...props}
		>
			<span
				aria-hidden="true"
				className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
			>
				{isCompleted ? (
					<CheckIcon className="size-3.5 text-emerald-500" />
				) : status === "in_progress" ? (
					<LoaderCircleIcon className="size-3.5 animate-spin text-amber-500" />
				) : (
					<CircleIcon className="size-2.5 text-muted-foreground/50" />
				)}
			</span>
			<span
				className={cn(
					"min-w-0 break-words",
					isCompleted && "text-muted-foreground line-through",
				)}
			>
				{children}
			</span>
			<span className="sr-only">{statusLabel}</span>
		</li>
	);
};

export type PlanTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export const PlanTrigger = ({ className, ...props }: PlanTriggerProps) => {
	const { t } = useTranslation("aiElements");

	return (
		<CollapsibleTrigger asChild>
			<Button
				className={cn("size-8", className)}
				data-slot="plan-trigger"
				size="icon"
				variant="ghost"
				{...props}
			>
				<ChevronsUpDownIcon className="size-4" />
				<span className="sr-only">{t("plan.toggle")}</span>
			</Button>
		</CollapsibleTrigger>
	);
};
