import { readFile } from 'node:fs/promises';
import type { Day, Days } from '../types/days';

/**
 * Format a date as a local-time `YYYY-MM-DD` key, the bucket every source aggregates into.
 * Keys sort lexically in date order, so callers compare them with `<` / `>`.
 *
 * @returns the local calendar date of `date`, e.g. `"2026-10-10"`.
 * Called by: keyOfTimestamp, grid.buildGrid, cli (window start).
 * Calls: nothing.
 */
export const dayKey = (date: Date): string =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Turn an ISO timestamp from a transcript or git log into a local day key.
 *
 * @returns the day key, or `null` when the timestamp is missing or unparseable.
 * Called by: loadClaude, loadCodex, loadGit.
 * Calls: dayKey.
 */
export const keyOfTimestamp = (timestamp: string | undefined): string | null => {
	if (!timestamp) return null;
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? null : dayKey(date);
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
	let aggregate = days.get(key);
	if (!aggregate) {
		aggregate = {
			sessions: { claude: new Set(), codex: new Set() },
			prompts: { claude: 0, codex: 0 },
			tokens: { claude: 0, codex: 0 },
			commits: 0,
			aiCommits: 0,
			projects: new Map()
		};
		days.set(key, aggregate);
	}
	return aggregate;
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
 * @returns nothing; increments `aggregate.projects` in place (no-op when cwd is unknown).
 * Called by: loadClaude, loadCodex.
 * Calls: projectName.
 */
export function bumpProject(aggregate: Day, cwd: string | undefined) {
	const project = projectName(cwd);
	if (project) aggregate.projects.set(project, (aggregate.projects.get(project) ?? 0) + 1);
}

/**
 * Read a JSONL transcript in one go and parse it line by line. Malformed lines are skipped,
 * since the newest session file may still be mid-write. Records come out as `unknown`:
 * transcripts are outside data, narrowed by the caller (docs/CONVENTIONS.md §1.3).
 *
 * @returns an async generator of parsed records, in file order.
 * Called by: loadClaude, loadCodex.
 * Calls: readFile, JSON.parse.
 */
export async function* readJsonl(path: string): AsyncGenerator<unknown> {
	const text = await readFile(path, 'utf8');
	for (const line of text.split('\n')) {
		if (!line) continue;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			// A partial line from a session still being written: skip it, the rest of the file is fine.
			continue;
		}
		yield record;
	}
}
