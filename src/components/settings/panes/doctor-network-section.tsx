import { Loader2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/core/utils";
import type {
	NetworkDoctorReport,
	NetworkEndpointDiagnostic,
	NetworkStatus,
} from "@/lib/doctor/api";
import { DoctorSection } from "./doctor-sections";

function StatusDot({ status }: { status: NetworkStatus }) {
	return (
		<span
			className={cn(
				"mt-0.5 size-2 shrink-0 rounded-full",
				status === "reachable" && "bg-emerald-500",
				status === "timeout" && "bg-amber-500",
				status === "unreachable" && "bg-red-500",
			)}
			aria-hidden
		/>
	);
}

function EndpointRowShimmer() {
	return (
		<div
			className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5 last:border-b-0"
			aria-hidden
		>
			<div className="flex items-center gap-2.5">
				<Skeleton className="library-shimmer size-2 shrink-0 rounded-full" />
				<Skeleton className="library-shimmer h-3.5 w-24" />
			</div>
			<Skeleton className="library-shimmer h-3 w-14" />
		</div>
	);
}

function EndpointRow({ endpoint }: { endpoint: NetworkEndpointDiagnostic }) {
	const { t } = useTranslation(["settings", "cloud"]);
	const reachable = endpoint.status === "reachable";
	const hintKey =
		endpoint.status === "timeout"
			? "doctor.network.hints.timeout"
			: endpoint.status === "unreachable"
				? "doctor.network.hints.unreachable"
				: null;
	return (
		<div className="flex items-start gap-2.5 border-b px-3.5 py-2.5 last:border-b-0">
			<StatusDot status={endpoint.status} />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-3">
					<p className="font-medium text-sm">
						{t(`doctor.network.endpoints.${endpoint.id}`)}
					</p>
					<p
						className={cn(
							"shrink-0 text-xs",
							reachable ? "text-emerald-700" : "text-amber-700",
						)}
					>
						{reachable
							? t("doctor.network.latency", { ms: endpoint.latencyMs })
							: t(`doctor.network.status.${endpoint.status}`)}
					</p>
				</div>
				{endpoint.statusCode && !reachable ? (
					<p className="text-xs text-muted-foreground">
						HTTP {endpoint.statusCode}
					</p>
				) : null}
				{!reachable && hintKey ? (
					<div className="mt-1 space-y-0.5">
						{endpoint.detail ? (
							<p className="whitespace-pre-wrap break-words text-muted-foreground text-xs">
								{endpoint.detail}
							</p>
						) : null}
						<p className="text-muted-foreground text-xs">
							{t("cloud:doctor.networkRetry")}
						</p>
					</div>
				) : null}
			</div>
		</div>
	);
}

export function DoctorNetworkSection({
	report,
	loading,
	error,
}: {
	report: NetworkDoctorReport | null;
	loading: boolean;
	error?: string | null;
}) {
	const { t } = useTranslation(["settings", "cloud"]);
	const endpoints = report?.endpoints ?? [];
	const proxy = report?.proxy;
	const issues = error
		? 1
		: endpoints.filter((endpoint) => endpoint.status !== "reachable").length;
	const showShimmer = loading && !error && endpoints.length === 0;
	return (
		<DoctorSection
			title={t("doctor.sections.network")}
			description={t("cloud:doctor.networkHint")}
			ok={loading && !report ? null : issues === 0}
			issueCount={issues}
			action={
				loading && endpoints.length > 0 ? (
					<Loader2
						className="size-3.5 animate-spin text-muted-foreground"
						aria-hidden
					/>
				) : undefined
			}
		>
			{error ? (
				<div className="flex items-start gap-2.5 px-3.5 py-2.5">
					<TriangleAlert
						className="mt-0.5 size-3.5 shrink-0 text-amber-600"
						aria-hidden
					/>
					<p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs">
						{error}
					</p>
				</div>
			) : showShimmer ? (
				<div
					role="status"
					aria-busy="true"
					aria-label={t("doctor.network.probing")}
				>
					<EndpointRowShimmer />
					<EndpointRowShimmer />
					<EndpointRowShimmer />
				</div>
			) : endpoints.length > 0 ? (
				<>
					{endpoints.map((endpoint) => (
						<EndpointRow key={endpoint.id} endpoint={endpoint} />
					))}
					{proxy ? (
						<div className="px-3.5 py-2.5">
							<p className="text-muted-foreground text-xs">
								{t("doctor.network.proxy", { proxy })}
							</p>
						</div>
					) : null}
				</>
			) : (
				<div className="px-3.5 py-2.5">
					<p className="text-muted-foreground text-xs">
						{t("doctor.network.none")}
					</p>
				</div>
			)}
		</DoctorSection>
	);
}
