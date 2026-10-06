/**
 * Build a copy/paste Agent prompt for Doctor residual wikilink issues.
 * Language follows the app UI locale (zh-CN vs en).
 */

import type {
	WikiCheckIssue,
	WikilinkRepairResidual,
	WikilinkRepairSuggestion,
} from "@/lib/doctor/api";

function isChineseLocale(language?: string): boolean {
	const tag = (language ?? "").toLowerCase();
	return tag.startsWith("zh");
}

export function buildDoctorWikilinkAgentPrompt(input: {
	vaultPath: string;
	residuals: WikilinkRepairResidual[];
	/** Lightweight suggestions already offered in Doctor (for context). */
	suggestions?: WikilinkRepairSuggestion[];
	/** Full diagnosis issues when residuals alone are thin. */
	issues?: WikiCheckIssue[];
	/** BCP-47 / i18n language (e.g. zh-CN, en). Defaults to English. */
	language?: string;
}): string {
	const zh = isChineseLocale(input.language);

	const residualLines = input.residuals.map((item, index) => {
		const bits = [
			`${index + 1}. ${item.source}:${item.line}`,
			`status=${item.status}`,
			`editKind=${item.editKind}`,
			`current="${item.expected}"`,
			`targetRaw="${item.targetRaw}"`,
		];
		if (item.targetPath) bits.push(`resolvedPath=${item.targetPath}`);
		if (item.candidates?.length) {
			bits.push(`candidates=${item.candidates.join(" | ")}`);
		}
		if (item.context) bits.push(`context=${item.context}`);
		return bits.join(" · ");
	});

	const suggestionLines = (input.suggestions ?? []).map((item, index) => {
		return `${index + 1}. ${item.source}:${item.line} · ${item.expected} → ${item.suggestedReplacement} (${item.layer})`;
	});

	const issueLines = (input.issues ?? []).map((item, index) => {
		return `${index + 1}. ${item.source}:${item.line} · ${item.status} · ${item.targetRaw}`;
	});

	const copy = zh
		? {
				role: "你在帮助修复 Lattiora Vault 中失效的本地双链。",
				vault: `Vault 路径：${input.vaultPath}`,
				taskTitle: "任务：",
				tasks: [
					"- 阅读列出的坏链（必要时查看附近笔记内容）。",
					"- 合理使用 Vault 工具（读文件 / 搜索）定位正确目标。",
					"- 先给出具体修改计划：每条写明 文件路径 + 旧链接文本 → 新链接文本。",
					"- 在我明确同意之前，不要修改任何文件。",
					"- 优先最小改动（只改链接 target / fragment 文本）。",
					"- 保持 Obsidian 兼容的 [[wikilink]] / Markdown 链接写法。",
				],
				residualTitle: "轻量探测未能安全修复的链接：",
				suggestionTitle:
					"可选上下文 — Doctor 已给出的轻量修复建议（设置页中可能已勾选）：",
				issueTitle: "诊断出的全部双链问题：",
				closing: "准备好后，只回复编号计划。在我确认 OK 之前不要写入。",
			}
		: {
				role: "You are helping repair broken Vault-local wiki links in Lattiora.",
				vault: `Vault path: ${input.vaultPath}`,
				taskTitle: "Task:",
				tasks: [
					"- Read the listed broken links (and nearby note content if needed).",
					"- Use Vault tools reasonably (read/search files) to find the correct targets.",
					"- Propose a concrete fix list first: for each item, show old → new link text and file path.",
					"- Do NOT modify files until I explicitly approve the plan.",
					"- Prefer minimal edits (only the link target / fragment text).",
					"- Keep Obsidian-compatible [[wikilinks]] / Markdown links as written.",
				],
				residualTitle:
					"Links that lightweight Doctor probe could not fix safely:",
				suggestionTitle:
					"Optional context — Doctor already proposed these lightweight fixes (may already be selected in UI):",
				issueTitle: "All diagnosed wiki-link issues:",
				closing:
					"When ready, reply with a numbered plan only. Wait for my OK before writing.",
			};

	const sections = [
		copy.role,
		copy.vault,
		"",
		copy.taskTitle,
		...copy.tasks,
		"",
	];

	if (residualLines.length > 0) {
		sections.push(copy.residualTitle, ...residualLines, "");
	}

	if (suggestionLines.length > 0) {
		sections.push(copy.suggestionTitle, ...suggestionLines, "");
	}

	if (residualLines.length === 0 && issueLines.length > 0) {
		sections.push(copy.issueTitle, ...issueLines, "");
	}

	sections.push(copy.closing);

	return sections.join("\n");
}
