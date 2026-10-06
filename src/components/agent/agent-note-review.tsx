import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	type AgentEdit,
	readAgentEdit,
	resolveAgentEdit,
} from "@/lib/cloud/agent-edits";
import { cloudAiError } from "@/lib/cloud/ai";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import { notifyError } from "@/lib/core/notify";

/** Recovery data lives beside the session, so review survives reload and synchronization. */
export function AgentNoteReview({ output }: { output: unknown }) {
	const id =
		output &&
		typeof output === "object" &&
		"editId" in output &&
		typeof output.editId === "string"
			? output.editId
			: null;
	const { t } = useTranslation("agent");
	const [edit, setEdit] = useState<AgentEdit | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!id) return;
		let live = true;
		const refresh = () =>
			void readAgentEdit(id)
				.then((value) => {
					if (live) setEdit(value);
				})
				.catch(() => {
					if (live) setEdit(null);
				});
		refresh();
		const off = subscribeCloudFiles((paths) => {
			if (paths.includes(`.agentero/agent-edits/${id}.json`)) refresh();
		});
		return () => {
			live = false;
			off();
		};
	}, [id]);
	if (!id || !edit) return null;
	const resolve = async (action: "kept" | "reverted") => {
		setBusy(true);
		try {
			await resolveAgentEdit(id, action);
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="space-y-2 px-2 pb-2" data-agent-note-review>
			<details>
				<summary className="cursor-pointer text-xs text-muted-foreground">
					{edit.path}
				</summary>
				<div className="grid max-h-64 gap-2 overflow-auto text-xs">
					<pre className="whitespace-pre-wrap bg-destructive/10 p-2">
						{edit.before ?? ""}
					</pre>
					<pre className="whitespace-pre-wrap bg-primary/10 p-2">
						{edit.after}
					</pre>
				</div>
			</details>
			{edit.status === "pending" ? (
				<div className="flex gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => void resolve("kept")}
					>
						{t("web.keep")}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() => void resolve("reverted")}
					>
						{t("web.revert")}
					</Button>
				</div>
			) : (
				<span className="text-xs text-muted-foreground">
					{t(`web.${edit.status}`)}
				</span>
			)}
		</div>
	);
}
