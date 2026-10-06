export type SettingsSection =
	| "general"
	| "appearance"
	| "agent"
	| "translate"
	| "layout"
	| "doctor"
	| "keyboard"
	| "sync"
	| "about";

/** Which machine the Agent catalog / probe targets. */
export type SettingsHostContext =
	| { kind: "local" }
	| {
			kind: "remote";
			label: string;
			sessionId: string;
			host: string;
			remotePath: string;
	  };
