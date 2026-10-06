import type { ComponentProps, ComponentPropsWithRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/core/utils";

export { Panel as ResizablePanel };

export function ResizableGroup({
	className,
	...props
}: ComponentPropsWithRef<typeof Group>) {
	return <Group className={cn("isolate", className)} {...props} />;
}

/**
 * Editor-style sash (VS Code / Cursor): 1px line, wider invisible hit target.
 */
export function ResizableHandle({
	className,
	...props
}: ComponentProps<typeof Separator>) {
	return (
		<Separator
			className={cn(
				// Visual: single 1px rule; hit area via ::after (~5px)
				"relative z-10 w-px shrink-0 bg-border outline-none transition-colors",
				"hover:bg-foreground/25 data-[separator=active]:bg-foreground/35",
				"after:absolute after:inset-y-0 after:left-1/2 after:w-[5px] after:-translate-x-1/2",
				"after:content-['']",
				className,
			)}
			{...props}
		/>
	);
}
