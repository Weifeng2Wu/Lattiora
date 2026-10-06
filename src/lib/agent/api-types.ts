/**
 * Pure type leaf for the Agent catalog API.
 *
 * `api.ts` re-exports these for backward compatibility; cross-domain modules
 * (e.g. remote vault) must import from here so type-only references do not
 * create import cycles through the runtime module.
 */

export type CatalogAcpStatus = "missing" | "not-probed" | "ready" | "failed";

export type CatalogEntry = {
	templateId: string;
	name: string;
	description: string;
	command: string;
	args: string[];
	installHint: string;
	/** Shell command for guided install (e.g. Claude ACP adapter via npm). */
	installCommand?: string | null;
	/** Host CLI OAuth/login command opened by Agentero's terminal helper. */
	loginCommand?: string | null;
	/** Host CLI present but ACP entrypoint missing — offer ACP install. */
	offerInstall?: boolean;
	/** Local silent install via `runToolLifecycle` is supported. */
	canInstall?: boolean;
	/** Host detect binary differs from ACP entrypoint (Claude/Codex adapters). */
	adapterDistinct?: boolean;
	/** Agent host CLI on PATH (`detect_command`). */
	binaryAvailable: boolean;
	resolvedPath?: string | null;
	/** ACP entrypoint on PATH (`command`), or served by the bundled tier. */
	acpCommandAvailable: boolean;
	/** Bundled ACP adapter tier present in app resources (offline fallback). */
	acpBundled?: boolean;
	/** Version of the bundled adapter, when staged. */
	acpBundledVersion?: string | null;
	acpStatus: CatalogAcpStatus;
	registeredId?: string | null;
	isDefault: boolean;
	acpAgentName?: string | null;
	lastProbeError?: string | null;
	lastProbedAt?: string | null;
	/** Normalized local host CLI version, when known. */
	installedVersion?: string | null;
	/** Silent-update target (npm latest), when known. */
	latestVersion?: string | null;
	/** Settings shows Upgrade only when this is explicitly true. */
	updateAvailable?: boolean | null;
};

export type AcpSessionCapabilities = {
	list: boolean;
	resume: boolean;
	load: boolean;
	delete: boolean;
};

export type ProbeResult = {
	agentId: string;
	available: boolean;
	agentName?: string | null;
	protocolVersion?: string | null;
	error?: string | null;
	sessionCapabilities?: AcpSessionCapabilities | null;
};
