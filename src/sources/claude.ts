import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Days } from '../../types/days';
import { bumpProject, day, keyOfTimestamp, readJsonl } from '../days';
import { asArray, asNumber, asObject, asString } from '../json';

export const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');

/**
 * Decide whether a Claude Code transcript record is a prompt a human typed, as opposed to
 * a tool result, a slash-command echo (`<command-name>…`), a task notification, or an
 * injected meta/sidechain (sub-agent) message.
 *
 * @returns true for genuine human prompts.
 * Called by: loadClaude, tests.
 * Calls: asObject, asString, asArray.
 */
export function isHumanPrompt(raw: unknown): boolean {
	const record = asObject(raw);
	if (record.type !== 'user' || record.isMeta === true || record.isSidechain === true) return false;
	const kind = asString(asObject(record.origin).kind);
	if (kind && kind !== 'human') return false;
	const content = asObject(record.message).content;
	if (typeof content === 'string') return !content.startsWith('<');
	const blockTypes = asArray(content).map((block) => asString(asObject(block).type));
	return blockTypes.includes('text') && !blockTypes.includes('tool_result');
}

/**
 * Aggregate every Claude Code transcript under `root` (default `~/.claude/projects`, including
 * sub-agent files) into `days`: prompts and per-project prompt counts, distinct session ids,
 * and fresh tokens (uncached input + cache writes + output, cache reads excluded). Records
 * before `since` are ignored. Usage is deduplicated by message id, because one API response
 * is written as several lines that all repeat the same usage block.
 *
 * @returns the number of transcript files scanned (0 if `root` doesn't exist); mutates `days`.
 * Called by: cli, tests.
 * Calls: readJsonl, keyOfTimestamp, day, bumpProject, isHumanPrompt, asObject, asString, asNumber.
 */
export async function loadClaude(days: Days, since: string, root = CLAUDE_PROJECTS): Promise<number> {
	if (!existsSync(root)) return 0;
	const seenMessages = new Set<string>();
	let files = 0;
	for await (const relativePath of new Glob('**/*.jsonl').scan({ cwd: root, onlyFiles: true })) {
		files++;
		for await (const raw of readJsonl(join(root, relativePath))) {
			const record = asObject(raw);
			const key = keyOfTimestamp(asString(record.timestamp));
			if (!key || key < since) continue;
			const message = asObject(record.message);
			const sessionId = asString(record.sessionId);

			if (record.type === 'assistant' && message.usage) {
				const messageId = asString(message.id) ?? asString(record.requestId);
				if (messageId && seenMessages.has(messageId)) continue;
				if (messageId) seenMessages.add(messageId);
				const usage = asObject(message.usage);
				const aggregate = day(days, key);
				aggregate.tokens.claude +=
					asNumber(usage.input_tokens) + asNumber(usage.cache_creation_input_tokens) + asNumber(usage.output_tokens);
				if (sessionId) aggregate.sessions.claude.add(sessionId);
			} else if (isHumanPrompt(record)) {
				const aggregate = day(days, key);
				aggregate.prompts.claude++;
				if (sessionId) aggregate.sessions.claude.add(sessionId);
				bumpProject(aggregate, asString(record.cwd));
			}
		}
	}
	return files;
}
