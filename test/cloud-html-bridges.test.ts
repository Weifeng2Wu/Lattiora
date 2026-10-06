import { expect, it } from "vitest";
import { COOLPAPERS_BRIDGE } from "../src/lib/cloud/coolpapers-bridge";
import { HTML_READER_BRIDGE } from "../src/lib/cloud/html-bridge";

it("ships syntactically valid embedded reader scripts that TypeScript cannot check", () => {
	for (const source of [HTML_READER_BRIDGE, COOLPAPERS_BRIDGE])
		expect(() => new Function(source)).not.toThrow();
});
