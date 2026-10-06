import type { ReactNode } from "react";

import { cn } from "@/lib/core/utils";

/** Shared pane title bar height — keep all three columns aligned (36px / 2.25rem). */
export const PANE_HEADER_CLASS =
	"flex h-9 shrink-0 select-none items-center gap-1.5 border-b px-2.5 text-sm leading-none";

type PaneHeaderProps = {
	children: ReactNode;
	className?: string;
	/** Secondary content (actions or title) */
	trailing?: ReactNode;
};

export function PaneHeader({ children, className, trailing }: PaneHeaderProps) {
	return (
		<div className={cn(PANE_HEADER_CLASS, className)}>
			<div className="flex h-full min-w-0 flex-1 items-center gap-2">
				{children}
			</div>
			{trailing ? (
				<div className="flex h-full min-h-0 shrink-0 items-center gap-1">
					{trailing}
				</div>
			) : null}
		</div>
	);
}
