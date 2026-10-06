/** Coerce unknown thrown values into a display string. */
export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
