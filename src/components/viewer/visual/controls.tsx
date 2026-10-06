import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

export function IconButton({
	label,
	...props
}: ComponentProps<typeof Button> & { label: string }) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			className="size-8 shrink-0"
			aria-label={label}
			title={label}
			{...props}
		/>
	);
}

export const fieldClass =
	"min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-ring focus:ring-2 focus:ring-ring/20";
