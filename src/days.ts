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

export const dayKey = (d: Date): string =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const keyOfTimestamp = (ts: string | undefined): string | null => {
	if (!ts) return null;
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? null : dayKey(d);
};

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

export const projectName = (cwd: string | undefined): string | null => {
	if (!cwd) return null;
	const parts = cwd.split('/').filter(Boolean);
	return parts.slice(-2).join('/') || null;
};

export function bumpProject(d: Day, cwd: string | undefined) {
	const p = projectName(cwd);
	if (p) d.projects.set(p, (d.projects.get(p) ?? 0) + 1);
}

/** Read a JSONL file, yielding parsed objects and skipping malformed lines. */
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
