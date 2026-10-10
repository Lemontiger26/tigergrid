import type { Tool } from './days';

/** One row of `tigergrid --json`: a Day with Sets and Maps flattened to plain values. */
export interface JsonDay {
	date: string;
	sessions: Record<Tool, number>;
	prompts: Record<Tool, number>;
	tokens: Record<Tool, number>;
	commits: number;
	aiCommits: number;
	projects: Record<string, number>;
}
