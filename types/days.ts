export type Tool = 'claude' | 'codex';

/** Everything recorded for one local calendar day. */
export interface Day {
	sessions: Record<Tool, Set<string>>;
	prompts: Record<Tool, number>;
	/** Fresh tokens: uncached input + cache writes + output. */
	tokens: Record<Tool, number>;
	commits: number;
	aiCommits: number;
	/** Project name → prompts sent in it. */
	projects: Map<string, number>;
}

/** Day key (`YYYY-MM-DD`) → that day's aggregate. */
export type Days = Map<string, Day>;
