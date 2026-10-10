import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bumpProject, day, keyOfTimestamp, readJsonl, type Days } from '../days';

export const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');

/**
 * Decide whether a Claude Code transcript record is a prompt a human typed, as opposed to
 * a tool result, a slash-command echo (`<command-name>…`), a task notification, or an
 * injected meta/sidechain (sub-agent) message.
 *
 * @returns true for genuine human prompts.
 * Called by: loadClaude, tests.
 * Calls: nothing.
 */
export function isHumanPrompt(r: any): boolean {
	if (r.type !== 'user' || r.isMeta || r.isSidechain) return false;
	const kind = r.origin?.kind;
	if (kind && kind !== 'human') return false;
	const c = r.message?.content;
	if (typeof c === 'string') return !c.startsWith('<');
	if (Array.isArray(c)) return c.some((b: any) => b.type === 'text') && !c.some((b: any) => b.type === 'tool_result');
	return false;
}

/**
 * Aggregate every Claude Code transcript under `root` (default `~/.claude/projects`, including sub-agent
 * files) into `days`: prompts and per-project prompt counts, distinct session ids, and fresh
 * tokens (uncached input + cache writes + output, cache reads excluded). Records before
 * `since` are ignored. Usage is deduplicated by message id, because one API response is
 * written as several lines that all repeat the same usage block.
 *
 * @returns the number of transcript files scanned (0 if `root` doesn't exist); mutates `days`.
 * Called by: cli, tests.
 * Calls: readJsonl, keyOfTimestamp, day, bumpProject, isHumanPrompt.
 */
export async function loadClaude(days: Days, since: string, root = CLAUDE_PROJECTS): Promise<number> {
	if (!existsSync(root)) return 0;
	const seenMessages = new Set<string>();
	let files = 0;
	for await (const rel of new Glob('**/*.jsonl').scan({ cwd: root, onlyFiles: true })) {
		files++;
		for await (const r of readJsonl(join(root, rel))) {
			const key = keyOfTimestamp(r.timestamp);
			if (!key || key < since) continue;

			if (r.type === 'assistant' && r.message?.usage) {
				const id = r.message.id ?? r.requestId;
				if (id && seenMessages.has(id)) continue;
				if (id) seenMessages.add(id);
				const u = r.message.usage;
				const d = day(days, key);
				d.tokens.claude += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
				if (r.sessionId) d.sessions.claude.add(r.sessionId);
			} else if (isHumanPrompt(r)) {
				const d = day(days, key);
				d.prompts.claude++;
				if (r.sessionId) d.sessions.claude.add(r.sessionId);
				bumpProject(d, r.cwd);
			}
		}
	}
	return files;
}
