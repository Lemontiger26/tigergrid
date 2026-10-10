// Narrowing helpers for transcript records. Transcripts are outside data (written by other
// tools, in formats that change without notice), so every record starts as `unknown` and each
// field is read through one of these: a wrong type becomes "absent", never a crash or a NaN.

/**
 * View a value as a JSON object so its fields can be read.
 *
 * @returns the value itself if it's a non-array object, otherwise an empty object.
 * Called by: sources/claude, sources/codex.
 * Calls: nothing.
 */
export function asObject(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	// A non-null, non-array object; JSON objects have string keys only.
	return value as Record<string, unknown>;
}

/**
 * Read a string field.
 *
 * @returns the string, or undefined for any other type.
 * Called by: sources/claude, sources/codex.
 * Calls: nothing.
 */
export const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * Read a numeric field, treating a missing or malformed number as 0 so it can be summed.
 *
 * @returns the finite number, or 0.
 * Called by: sources/claude, sources/codex.
 * Calls: nothing.
 */
export const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Read an array field.
 *
 * @returns the array (items still `unknown`), or an empty array for any other type.
 * Called by: sources/claude, sources/codex.
 * Calls: nothing.
 */
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
