/**
 * Id generators shared by the Agent chat and PDF visual-trace domains
 * (neutral seam, P2-18 sink). Previously each domain owned one half
 * (`agent/chat-state` held line/part counters, `pdf/agent-trace/io` held
 * trace ids) and the other reached across — both now import from here.
 */

import { nanoid } from "nanoid";

/** New visual mark / trace id (becomes `marks/<id>.json` on submit). */
export function newTraceId(): string {
	return nanoid(10);
}

/** New id for one transcript message inside a visual trace. */
export function newTraceMessageId(): string {
	return nanoid(10);
}

let chatLineSeq = 0;
export function nextLineId(prefix: string) {
	chatLineSeq += 1;
	return `${prefix}-${chatLineSeq}`;
}

let agentPartSeq = 0;
export function nextPartId(prefix: string) {
	agentPartSeq += 1;
	return `${prefix}-${agentPartSeq}`;
}

/** Test helper — reset module counters between cases. */
export function resetAgentChatIds() {
	chatLineSeq = 0;
	agentPartSeq = 0;
}
