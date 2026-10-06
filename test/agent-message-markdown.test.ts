import { describe, expect, it } from "vitest";
import { cleanCitationHref } from "@/lib/agent/citation-href";
import {
	prefixVaultMarkdownHrefs,
	prepareAgentMessageMarkdown,
} from "@/lib/agent/message-markdown";

describe("prefixVaultMarkdownHrefs", () => {
	it("prefixes bare vault citation hrefs so rehype-harden keeps them", () => {
		expect(
			prefixVaultMarkdownHrefs(
				"问？[摘要](papers/vla/2504.16054/2504.16054.pdf#page=1)",
			),
		).toBe("问？[摘要](./papers/vla/2504.16054/2504.16054.pdf#page=1)");
	});

	it("does not double-prefix", () => {
		expect(
			prefixVaultMarkdownHrefs(
				"[图7](./papers/vla/2504.16054/2504.16054.pdf#figure=7)",
			),
		).toBe("[图7](./papers/vla/2504.16054/2504.16054.pdf#figure=7)");
	});

	it("leaves http links alone", () => {
		expect(prefixVaultMarkdownHrefs("[arXiv](https://arxiv.org/abs/1)")).toBe(
			"[arXiv](https://arxiv.org/abs/1)",
		);
	});
});

describe("prepareAgentMessageMarkdown", () => {
	it("keeps citation links and prefixes vault hrefs", () => {
		const input =
			"核心问题？[摘要](papers/vla/2504.16054/2504.16054.pdf#page=1)\n\n详见[图7](papers/vla/2504.16054/2504.16054.pdf#figure=7)和第4.1节。";
		const out = prepareAgentMessageMarkdown(input);
		expect(out).toContain(
			"[摘要](./papers/vla/2504.16054/2504.16054.pdf#page=1)",
		);
		expect(out).toContain(
			"[图7](./papers/vla/2504.16054/2504.16054.pdf#figure=7)",
		);
		expect(out).not.toMatch(/\[.*\[摘要\]/);
	});
});

describe("cleanCitationHref", () => {
	it("strips the ./ prefix added for Streamdown harden", () => {
		expect(
			cleanCitationHref("./papers/vla/2504.16054/2504.16054.pdf#page=1"),
		).toBe("papers/vla/2504.16054/2504.16054.pdf#page=1");
	});
});
