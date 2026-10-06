/**
 * Native 广场 panel: curated research Skill repos as GitHub-style cards.
 * Card click runs the 魔棒 Skill import; the corner link opens GitHub.
 */

import { ExternalLink, Loader2, Star } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { SkillUploadButton } from "@/components/dialogs/skill-upload-button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { openExternalUrl } from "@/lib/core/open-external";
import { cn } from "@/lib/core/utils";
import { importPlazaSkillRepo } from "@/lib/plaza/import";
import {
	SKILL_THEMES,
	type SkillRepo,
	type SkillThemeId,
} from "@/lib/plaza/skill-catalog";

function formatStars(n: number): string {
	if (n >= 1000) {
		const k = n / 1000;
		return `${k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "")}k`;
	}
	return String(n);
}

function RepoCard({ repo }: { repo: SkillRepo }) {
	const { t } = useTranslation("sidebar");
	const [busy, setBusy] = useState(false);
	const fullName = `${repo.owner}/${repo.repo}`;

	const importRepo = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		try {
			await importPlazaSkillRepo(repo.url);
		} finally {
			setBusy(false);
		}
	}, [busy, repo.url]);

	return (
		<div
			className={cn(
				"group flex items-center gap-3 rounded-lg border bg-background p-2.5",
				"transition-colors hover:border-foreground/20 hover:bg-muted/50",
				busy && "pointer-events-none opacity-70",
			)}
		>
			<button
				type="button"
				disabled={busy}
				tabIndex={-1}
				aria-hidden
				onClick={() => void importRepo()}
				className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				<img
					src={`https://avatars.githubusercontent.com/${repo.owner}?s=128`}
					alt=""
					width={48}
					height={48}
					className="size-12 rounded-md object-cover shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
				/>
			</button>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={busy}
						aria-label={t("plaza.skills.import", { name: fullName })}
						onClick={() => void importRepo()}
						className={cn(
							"min-w-0 truncate text-left font-medium text-sm",
							"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						)}
					>
						{fullName}
					</button>
					{busy ? (
						<Loader2
							className="size-3.5 shrink-0 animate-spin text-muted-foreground"
							aria-hidden
						/>
					) : null}
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								className={cn(
									"ml-auto inline-flex shrink-0 items-center gap-0.5 text-muted-foreground text-xs",
									"rounded-sm hover:text-foreground",
									"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								)}
								aria-label={t("plaza.skills.openGithub")}
								onClick={() => openExternalUrl(repo.url)}
							>
								<Star
									className="size-3 fill-current group-hover:hidden"
									aria-hidden
								/>
								<ExternalLink
									className="hidden size-3 group-hover:block"
									aria-hidden
								/>
								{formatStars(repo.stars)}
							</button>
						</TooltipTrigger>
						<TooltipContent side="top">
							{t("plaza.skills.openGithub")}
						</TooltipContent>
					</Tooltip>
				</div>
				<button
					type="button"
					disabled={busy}
					onClick={() => void importRepo()}
					className={cn(
						"mt-0.5 line-clamp-2 w-full text-left text-muted-foreground text-xs leading-snug",
						"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					)}
				>
					{repo.description}
				</button>
			</div>
		</div>
	);
}

export function PlazaSkillsView({ className }: { className?: string }) {
	const { t } = useTranslation("sidebar");
	return (
		<div
			className={cn(
				"agentero-scroll h-full select-none overflow-y-auto p-4",
				className,
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<h1 className="font-medium text-base">{t("plaza.skills.title")}</h1>
				<SkillUploadButton />
			</div>
			<div className="mt-4 space-y-6">
				{SKILL_THEMES.map((theme) => (
					<section key={theme.id}>
						<h2 className="mb-2 font-medium text-muted-foreground text-xs">
							{t(`plaza.skills.themes.${theme.id as SkillThemeId}`)}
						</h2>
						<div className="grid grid-cols-3 items-start gap-2">
							{theme.repos.map((repo) => (
								<RepoCard key={repo.url} repo={repo} />
							))}
						</div>
					</section>
				))}
			</div>
		</div>
	);
}
