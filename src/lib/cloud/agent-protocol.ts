/** Provider-neutral messages. Credentials are deliberately absent. */
export type AgentToolCall = { id: string; name: string; arguments: string };
export type AgentMessage = {
	role: "user" | "assistant" | "tool";
	content: string;
	images?: { data: string; mimeType: string }[];
	toolCalls?: AgentToolCall[];
	toolCallId?: string;
};
export type AgentEvent =
	| { type: "delta" | "thought"; text: string }
	| { type: "tool_call"; call: AgentToolCall }
	| { type: "done"; reason: string }
	| { type: "error"; error: string };
export type AgentStep = {
	messages: AgentMessage[];
	context: string;
	instructions: string;
	model?: string;
	readOnly?: boolean;
};
const text = { type: "string" };
const object = (properties: Record<string, unknown>, required: string[]) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});
export const AGENT_TOOLS = [
	{
		name: "list_files",
		description:
			"List vault paths under a prefix, including available papers and notes. No operating-system access.",
		parameters: object({ prefix: text }, []),
	},
	{
		name: "read_document",
		description:
			"Read a vault text file or paper, or a bundled Skill reference. Paper paths resolve cached parsed text or browser PDF text. Start is a character offset; inspect truncated and nextStart before claiming full coverage.",
		parameters: object(
			{
				path: text,
				start: { type: "integer", minimum: 0 },
				length: { type: "integer", minimum: 1, maximum: 60000 },
			},
			["path"],
		),
	},
	{
		name: "search_documents",
		description:
			"Literal case-insensitive search of cached text files. Returns snippets and paths; uncached PDFs are not searched.",
		parameters: object({ query: text, prefix: text }, ["query"]),
	},
	{
		name: "write_note",
		description:
			"Create or replace a vault text note. You MUST first read an existing file and supply its complete exact text as expectedText. Use null only to create a new file. Permission and version checks may reject the write. Never report success without the tool result.",
		parameters: object(
			{ path: text, content: text, expectedText: { type: ["string", "null"] } },
			["path", "content", "expectedText"],
		),
	},
	{
		name: "update_plan",
		description:
			"Display or update the task plan. Status values: pending, in_progress, completed.",
		parameters: object(
			{
				entries: {
					type: "array",
					maxItems: 12,
					items: object(
						{
							content: text,
							status: {
								type: "string",
								enum: ["pending", "in_progress", "completed"],
							},
						},
						["content", "status"],
					),
				},
			},
			["entries"],
		),
	},
	{
		name: "ask_user",
		description:
			"Ask the user a question and wait for their answer. Optional suggested answers do not preclude free text.",
		parameters: object(
			{ question: text, options: { type: "array", maxItems: 6, items: text } },
			["question"],
		),
	},
] as const;
