export type Tool = 'claude' | 'codex';

export interface Day {
	sessions: Record<Tool, Set<string>>;
	prompts: Record<Tool, number>;
	tokens: Record<Tool, number>; // fresh tokens: uncached input + cache writes + output
	commits: number;
	aiCommits: number;
	projects: Map<string, number>; // project -> prompts
}

export type Days = Map<string, Day>;

/**
 * Format a date as a local-time `YYYY-MM-DD` key, the bucket every source aggregates into.
 * Keys sort lexically in date order, so callers compare them with `<` / `>`.
 *
 * @returns the local calendar date of `d`, e.g. `"2026-10-10"`.
 * Called by: keyOfTimestamp, grid.buildGrid, cli (window start).
 * Calls: nothing.
 */
export const dayKey = (d: Date): string =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Turn an ISO timestamp from a transcript or git log into a local day key.
 *
 * @returns the day key, or `null` when the timestamp is missing or unparseable.
 * Called by: loadClaude, loadCodex, loadGit.
 * Calls: dayKey.
 */
export const keyOfTimestamp = (ts: string | undefined): string | null => {
	if (!ts) return null;
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? null : dayKey(d);
};

/**
 * Get the aggregate for `key`, creating an empty one on first touch, so sources can
 * increment counters without checking for existence.
 *
 * @returns the mutable Day stored in `days` under `key`.
 * Called by: loadClaude, loadCodex, loadGit.
 * Calls: nothing.
 */
export function day(days: Days, key: string): Day {
	let d = days.get(key);
	if (!d) {
		d = {
			sessions: { claude: new Set(), codex: new Set() },
			prompts: { claude: 0, codex: 0 },
			tokens: { claude: 0, codex: 0 },
			commits: 0,
			aiCommits: 0,
			projects: new Map()
		};
		days.set(key, d);
	}
	return d;
}

/**
 * Shorten a working directory to its last two path segments, which is enough to tell
 * projects apart (`/Users/dev/acme/api` → `acme/api`).
 *
 * @returns the short project name, or `null` for an empty/missing cwd.
 * Called by: bumpProject.
 * Calls: nothing.
 */
export const projectName = (cwd: string | undefined): string | null => {
	if (!cwd) return null;
	const parts = cwd.split('/').filter(Boolean);
	return parts.slice(-2).join('/') || null;
};

/**
 * Count one prompt against the project the agent was running in.
 *
 * @returns nothing; increments `d.projects` in place (no-op when cwd is unknown).
 * Called by: loadClaude, loadCodex.
 * Calls: projectName.
 */
export function bumpProject(d: Day, cwd: string | undefined) {
	const p = projectName(cwd);
	if (p) d.projects.set(p, (d.projects.get(p) ?? 0) + 1);
}

/**
 * Read a JSONL transcript in one go and parse it line by line. Malformed lines are skipped,
 * since the newest session file may still be mid-write.
 *
 * @returns an async generator of parsed records, in file order.
 * Called by: loadClaude, loadCodex.
 * Calls: Bun.file().text, JSON.parse.
 */
export async function* readJsonl(path: string): AsyncGenerator<any> {
	const text = await Bun.file(path).text();
	for (const line of text.split('\n')) {
		if (!line) continue;
		try {
			yield JSON.parse(line);
		} catch {
			// partial line from a session still being written
		}
	}
}
