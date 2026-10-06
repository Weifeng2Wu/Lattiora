import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";
import { logger } from "@/lib/core/logger";

type Props = {
	children: ReactNode;
	label?: string;
};

type State = {
	error: Error | null;
};

/** Catches render crashes so the window does not go fully blank. */
export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		const label = this.props.label ? `:${this.props.label}` : "";
		logger.error(
			`ErrorBoundary${label} ${error.message} componentStack=${(info.componentStack ?? "").trim().slice(0, 400)}`,
		);
		console.error(`[ErrorBoundary${label}]`, error, info);
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
				<p className="font-medium text-sm">{i18n.t("common:somethingWrong")}</p>
				<p className="max-w-md break-words text-destructive text-xs">
					{error.message}
				</p>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => this.setState({ error: null })}
				>
					{i18n.t("common:tryAgain")}
				</Button>
			</div>
		);
	}
}
