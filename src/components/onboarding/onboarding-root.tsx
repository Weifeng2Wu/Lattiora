import { ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { LayoutStep } from "@/components/onboarding/steps/layout-step";
import { ThemeStep } from "@/components/onboarding/steps/theme-step";
import { TranslateStep } from "@/components/onboarding/steps/translate-step";
import { VaultChoiceStep } from "@/components/onboarding/steps/vault-choice-step";
import { WelcomeStep } from "@/components/onboarding/steps/welcome-step";
import { ThemeModeSwitch } from "@/components/onboarding/theme-mode-switch";
import { CloudAiConfigBlock as AgentStep } from "@/components/settings/panes/agent/cloud-ai-config-block";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-app-stores";
import { cloudAiError } from "@/lib/cloud/ai";
import { listLocalFiles } from "@/lib/cloud/files";
import { pickAndImportFiles } from "@/lib/cloud/import";
import { syncStore } from "@/lib/cloud/sync";
import { notifyError } from "@/lib/core/notify";
import { cn } from "@/lib/core/utils";
import { listenOnboardingRequest } from "@/lib/onboarding/api";
import { ensureSettingsLoaded, loadSettings } from "@/lib/settings";
import { patchSettings } from "@/lib/settings/react-store";
import type { OnboardingStepId } from "./flow";
import { onboardingFlow } from "./flow";
import {
	closeOnboarding,
	onboardingStore,
	requestOnboarding,
} from "./onboarding-store";

const useOnboardingStepper = onboardingFlow.useStepper;

function FlowDots({ index, labels }: { index: number; labels: string[] }) {
	const { t } = useTranslation("common");
	return (
		<fieldset className="flex items-center gap-1.5">
			<legend className="sr-only">{t("steps")}</legend>
			{labels.map((label, i) => (
				<span
					key={label}
					role="status"
					aria-label={label}
					className={cn(
						"h-1.5 rounded-full transition-all",
						i === index
							? "w-5 bg-primary"
							: i < index
								? "w-1.5 bg-primary/50"
								: "w-1.5 bg-muted-foreground/25",
					)}
				/>
			))}
		</fieldset>
	);
}

export function OnboardingRoot() {
	const open = useStore(onboardingStore, (s) => s.open);
	const lastSync = useStore(syncStore, (s) => s.lastSync);

	// Settings → main event: force the wizard open on demand.
	useEffect(() => {
		let cancelled = false;
		let unlisten: (() => void) | undefined;
		void listenOnboardingRequest(() => {
			if (!cancelled) requestOnboarding();
		}).then((off) => {
			if (cancelled) off();
			else unlisten = off;
		});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);

	useEffect(() => {
		if (!lastSync) return;
		let cancelled = false;
		void Promise.all([ensureSettingsLoaded(), listLocalFiles()])
			.then(([, files]) => {
				if (
					!cancelled &&
					// Finishing the wizard while files load must not reopen it.
					!loadSettings().onboardingDone &&
					!files.some(
						(f) =>
							!f.deleted &&
							!f.path.startsWith(".") &&
							f.mime !== "inode/directory",
					)
				)
					requestOnboarding();
			})
			.catch((error) => notifyError(cloudAiError(error)));
		return () => {
			cancelled = true;
		};
	}, [lastSync]);
	return open ? <OnboardingDialog /> : null;
}

function OnboardingDialog() {
	const { t } = useTranslation("onboarding");
	const stepper = useOnboardingStepper();
	const settings = useSettings((s) => s);
	const patch = patchSettings;

	/** Per-step "choice made" gate for the footer Next button. */
	const [gate, setGate] = useState<{
		id: OnboardingStepId;
		allowed: boolean;
	} | null>(null);
	const reportGate = useCallback((id: OnboardingStepId, allowed: boolean) => {
		setGate((prev) =>
			prev?.id === id && prev.allowed === allowed ? prev : { id, allowed },
		);
	}, []);

	const stepLabels = onboardingFlow.steps.map((step) => t(`steps.${step.id}`));

	const gated = ["translate", "layout"].includes(stepper.current.id);
	const canNext = gated
		? gate?.id === stepper.current.id && gate.allowed
		: true;
	const nextLabel = stepper.isLast
		? t("actions.finish")
		: stepper.isFirst
			? t("actions.start")
			: t("actions.next");

	const onNext = () => {
		if (stepper.isLast) {
			finish();
			return;
		}
		void stepper.next();
	};

	const finish = () => {
		patch({ onboardingDone: true });
		void import("@/lib/activity").then(({ track }) => {
			track("onboarding.complete");
		});
		closeOnboarding();
	};

	const onCreateVault = () => {
		void pickAndImportFiles()
			.then(finish)
			.catch((error) => notifyError(cloudAiError(error)));
	};

	const renderStep = () => {
		switch (stepper.current.id) {
			case "welcome":
				return <WelcomeStep />;
			case "theme":
				return <ThemeStep settings={settings} patch={patch} />;
			case "agent":
				return <AgentStep />;
			case "translate":
				return (
					<TranslateStep
						settings={settings}
						patch={patch}
						onUseDefault={() => void stepper.next()}
						onNextChange={reportGate}
					/>
				);
			case "layout":
				return (
					<LayoutStep
						settings={settings}
						patch={patch}
						onUseDefault={() => void stepper.next()}
						onNextChange={reportGate}
					/>
				);
			case "vault":
				return <VaultChoiceStep onCreate={onCreateVault} />;
		}
	};

	const currentCopy = (() => {
		switch (stepper.current.id) {
			case "theme":
				return { title: t("theme.title"), desc: t("theme.desc") };
			case "agent":
				return { title: t("agent.title"), desc: t("agent.desc") };
			case "translate":
				return { title: t("translate.title"), desc: t("translate.desc") };
			case "layout":
				return { title: t("layout.title"), desc: undefined };
			case "vault":
				return { title: t("vault.title"), desc: t("vault.desc") };
			default:
				return undefined;
		}
	})();
	const stepTitle = currentCopy?.title ?? t(`steps.${stepper.current.id}`);
	const stepDesc = currentCopy?.desc;

	return (
		<div className="fixed inset-0 z-40 flex select-none items-center justify-center bg-background p-6">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 overflow-hidden"
			>
				<div className="absolute -top-32 -left-24 size-96 rounded-full bg-primary/10 blur-3xl" />
				<div className="absolute -right-24 -bottom-32 size-96 rounded-full bg-primary/10 blur-3xl" />
			</div>

			<div className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
				{/* Header: current step title + per-step action */}
				<div className="flex items-start justify-between gap-3 px-6 pt-5">
					<div className="min-w-0 max-w-md">
						{stepper.current.id === "welcome" ? null : (
							<>
								<span className="font-medium text-sm">{stepTitle}</span>
								{stepDesc ? (
									<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
										{stepDesc}
									</p>
								) : null}
							</>
						)}
					</div>
					{stepper.current.id === "theme" ? (
						<ThemeModeSwitch
							value={settings.theme}
							onChange={(next) => patch({ theme: next })}
						/>
					) : null}
				</div>

				<div
					className={cn(
						"agentero-scroll max-h-[24rem] overflow-y-auto px-6 py-5",
					)}
				>
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={stepper.current.id}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{ duration: 0.16, ease: "easeOut" }}
						>
							{renderStep()}
						</motion.div>
					</AnimatePresence>
				</div>

				{/* Footer: back + progress + next */}
				<div className="relative flex items-center justify-between gap-3 border-t px-6 py-4">
					{stepper.isFirst ? (
						<div className="w-20" aria-hidden />
					) : (
						<Button
							type="button"
							variant="ghost"
							onClick={() => void stepper.prev()}
						>
							{t("actions.back")}
						</Button>
					)}
					{stepper.isFirst ? null : (
						<div className="absolute left-1/2 flex -translate-x-1/2 items-center">
							<FlowDots index={stepper.index} labels={stepLabels} />
						</div>
					)}
					<Button type="button" disabled={!canNext} onClick={onNext}>
						{nextLabel}
						{stepper.isFirst ? <ArrowRight data-icon="inline-end" /> : null}
					</Button>
				</div>
			</div>
		</div>
	);
}
