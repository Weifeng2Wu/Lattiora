"use client";

import { useEquationInput } from "@platejs/math/react";
import { CornerDownLeftIcon, RadicalIcon } from "lucide-react";
import type { TEquationElement } from "platejs";
import {
	createPrimitiveComponent,
	PlateElement,
	type PlateElementProps,
	useEditorRef,
	useElement,
	useReadOnly,
	useSelected,
} from "platejs/react";
import * as React from "react";
import { memo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/core/utils";
import { renderKatexToElement } from "@/lib/math/katex-cache";

const inlineKatexOptions: katex.KatexOptions = {
	displayMode: false,
	errorColor: "#cc0000",
	fleqn: false,
	leqno: false,
	output: "htmlAndMathml",
	strict: "warn",
	throwOnError: false,
	trust: false,
};

const displayKatexOptions: katex.KatexOptions = {
	...inlineKatexOptions,
	displayMode: true,
};

const Textarea = React.forwardRef<
	HTMLTextAreaElement,
	React.ComponentProps<"textarea">
>((props, ref) => <textarea ref={ref} {...props} />);
Textarea.displayName = "EquationTextarea";

const EquationInput = createPrimitiveComponent(Textarea)({
	propsHook: useEquationInput,
});

function useCachedEquationElement({
	texExpression,
	katexRef,
	options,
}: {
	texExpression: string;
	katexRef: React.RefObject<HTMLElement | null>;
	options: katex.KatexOptions;
}) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: katexRef is a stable DOM container; only the TeX source should trigger re-render.
	useEffect(() => {
		if (!katexRef.current) return;
		renderKatexToElement(texExpression, options, katexRef.current);
	}, [texExpression, options]);
}

function EquationPopoverContent({
	isInline,
	open,
	setOpen,
	placeholder,
}: {
	isInline: boolean;
	open: boolean;
	setOpen: (open: boolean) => void;
	placeholder: string;
}) {
	const editor = useEditorRef();
	const readOnly = useReadOnly();
	const element = useElement<TEquationElement>();

	if (readOnly) return null;

	const onClose = () => {
		setOpen(false);
		editor.tf.select(element, { focus: true, next: isInline });
	};

	return (
		<PopoverContent
			className="flex gap-2"
			onEscapeKeyDown={(e) => e.preventDefault()}
			contentEditable={false}
		>
			<EquationInput
				className="agentero-scroll max-h-[50vh] grow resize-none rounded-md border bg-transparent p-2 text-sm outline-none"
				state={{ isInline, open, onClose }}
				placeholder={placeholder}
				autoFocus
			/>
			<Button variant="secondary" className="px-3" onClick={onClose}>
				<CornerDownLeftIcon className="size-3.5" />
			</Button>
		</PopoverContent>
	);
}

function equationPropsEqual(
	prev: PlateElementProps<TEquationElement>,
	next: PlateElementProps<TEquationElement>,
): boolean {
	return (
		prev.element.texExpression === next.element.texExpression &&
		prev.element.type === next.element.type
	);
}

export const EquationElement = memo(function EquationElement(
	props: PlateElementProps<TEquationElement>,
) {
	const selected = useSelected();
	const [open, setOpen] = React.useState(false);
	const katexRef = React.useRef<HTMLDivElement | null>(null);

	useCachedEquationElement({
		texExpression: props.element.texExpression,
		katexRef,
		options: displayKatexOptions,
	});

	return (
		<PlateElement
			{...props}
			className="my-2 block w-full min-w-0 rounded-sm hover:bg-primary/10 data-[selected=true]:bg-primary/10"
			data-selected={selected}
		>
			<Popover open={open} onOpenChange={setOpen} modal={false}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className={cn(
							"group flex w-full min-w-0 cursor-pointer select-none items-stretch justify-center rounded-sm",
							props.element.texExpression.length === 0
								? "bg-muted p-3"
								: "px-2 py-2",
						)}
						contentEditable={false}
					>
						{props.element.texExpression.length > 0 ? (
							<div
								ref={katexRef}
								className="agentero-scroll-both agentero-scroll-x-only w-full min-w-0 overflow-x-auto overflow-y-hidden py-1 text-center [&_.katex-display]:my-0 [&_.katex-display]:min-w-max"
							/>
						) : (
							<span className="flex h-7 items-center gap-2 text-muted-foreground text-sm">
								<RadicalIcon className="size-5 text-muted-foreground/80" />
								<span>Add a TeX equation</span>
							</span>
						)}
					</button>
				</PopoverTrigger>
				<EquationPopoverContent
					isInline={false}
					open={open}
					setOpen={setOpen}
					placeholder="E = mc^2"
				/>
			</Popover>
			{props.children}
		</PlateElement>
	);
}, equationPropsEqual);

export const InlineEquationElement = memo(function InlineEquationElement(
	props: PlateElementProps<TEquationElement>,
) {
	const selected = useSelected();
	const [open, setOpen] = React.useState(false);
	const katexRef = React.useRef<HTMLDivElement | null>(null);

	useCachedEquationElement({
		texExpression: props.element.texExpression,
		katexRef,
		options: inlineKatexOptions,
	});

	return (
		<PlateElement
			{...props}
			className="mx-0.5 inline-flex max-w-full select-none rounded-sm align-middle"
		>
			<Popover open={open} onOpenChange={setOpen} modal={false}>
				<PopoverTrigger asChild>
					<span
						className={cn(
							"inline-flex max-w-full cursor-pointer items-center rounded-sm px-1 py-0.5 align-middle hover:bg-primary/10",
							selected && "bg-primary/10",
							props.element.texExpression.length === 0 &&
								"text-muted-foreground",
						)}
						contentEditable={false}
					>
						<span
							ref={katexRef}
							className={cn(
								props.element.texExpression.length === 0 && "hidden",
								"min-w-0 max-w-full font-mono leading-normal",
							)}
						/>
						{props.element.texExpression.length === 0 && (
							<span className="inline-flex items-center gap-1">
								<RadicalIcon className="size-4" />
								equation
							</span>
						)}
					</span>
				</PopoverTrigger>
				<EquationPopoverContent
					isInline
					open={open}
					setOpen={setOpen}
					placeholder="E = mc^2"
				/>
			</Popover>
			{props.children}
		</PlateElement>
	);
}, equationPropsEqual);
