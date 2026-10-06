export type AcpCommand = {
	id: string;
	name: string;
	title: string;
	description: string;
	inputHint?: string;
};

/**
 * Normalize an ACP available-command name for slash insertion.
 * Agents may advertise names with leading `/` and/or `$` (e.g. skills as `$name`);
 * Composer always prefixes `/`, so strip those markers to avoid `/$foo`.
 */
export function normalizeAcpCommandName(raw: string): string {
	return raw.trim().replace(/^[/$]+/, "");
}

export function mapAcpCommands(
	commands: Array<{
		name: string;
		description: string;
		input?: { hint: string } | null;
	}>,
): AcpCommand[] {
	return commands
		.map((command) => {
			const name = normalizeAcpCommandName(command.name);
			return {
				id: `acp:${name}`,
				name,
				title: name,
				description: command.description.trim(),
				inputHint: command.input?.hint?.trim() || undefined,
			};
		})
		.filter((command) => command.name.length > 0);
}

export function filterSlashCommands(
	commands: AcpCommand[],
	query: string,
): AcpCommand[] {
	const q = query.toLowerCase().trim();
	return commands
		.filter((command) => {
			if (!q) return true;
			return [command.name, command.title, command.description].some((value) =>
				value.toLowerCase().includes(q),
			);
		})
		.slice(0, 8);
}
