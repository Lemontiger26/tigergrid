import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Days } from '../../types/days';
import { bumpProject, day, keyOfTimestamp, readJsonl } from '../days';
import { asArray, asNumber, asObject, asString } from '../json';

export const CODEX_HOME = join(homedir(), '.codex');

/**
 * Read Codex's import ledger, which lists threads Codex copied from other agents
 * (e.g. Claude Code). Those copies carry the import time as their timestamp and are
 * already counted at their source, so they must be skipped.
 *
 * @returns the set of imported Codex thread ids; empty if the ledger is missing or invalid.
 * Called by: loadCodex.
 * Calls: Bun.file().json, asObject, asArray, asString.
 */
async function importedThreadIds(home: string): Promise<Set<string>> {
	let ledger: unknown;
	try {
		ledger = await Bun.file(join(home, 'external_agent_session_imports.json')).json();
	} catch {
		// No ledger (Codex never imported anything) or an unreadable one: nothing to skip.
		return new Set();
	}
	const ids = asArray(asObject(ledger).records).map((entry) => asString(asObject(entry).imported_thread_id));
	return new Set(ids.filter((id): id is string => Boolean(id)));
}

/**
 * Compute fresh tokens from a Codex usage block: input minus cached input, plus output.
 * Matches the Claude definition (cache reads excluded).
 *
 * @returns a non-negative token count; 0 for a missing block.
 * Called by: loadCodex, tests.
 * Calls: asObject, asNumber.
 */
export const fresh = (rawUsage: unknown): number => {
	const usage = asObject(rawUsage);
	return (
		Math.max(0, asNumber(usage.input_tokens) - asNumber(usage.cached_input_tokens)) + asNumber(usage.output_tokens)
	);
};

/**
 * Aggregate every Codex rollout under `<home>/sessions` and `<home>/archived_sessions` (home
 * defaults to `~/.codex`) into `days`: prompts (`task_started` turns outside sub-agent
 * threads), per-project prompt counts, distinct session ids, and fresh tokens. Imported threads
 * are skipped. Tokens come from `token_usage_record` (newer rollouts, deduplicated by response
 * id) or, in older rollouts, from `token_count` events, skipping repeats of the same running total.
 *
 * @returns the number of rollout files scanned (imported ones included); mutates `days`.
 * Called by: cli, tests.
 * Calls: importedThreadIds, readJsonl, keyOfTimestamp, day, bumpProject, fresh, asObject, asString, asNumber.
 */
export async function loadCodex(days: Days, since: string, home = CODEX_HOME): Promise<number> {
	const imported = await importedThreadIds(home);
	let files = 0;
	for (const root of ['sessions', 'archived_sessions'].map((dir) => join(home, dir))) {
		if (!existsSync(root)) continue;
		for await (const relativePath of new Glob('**/*.jsonl').scan({ cwd: root, onlyFiles: true })) {
			files++;
			const records: Record<string, unknown>[] = [];
			for await (const raw of readJsonl(join(root, relativePath))) records.push(asObject(raw));

			const hasUsageRecords = records.some((record) => record.type === 'token_usage_record');
			const seenResponses = new Set<string>();
			let lastTotal = -1;
			// The first session_meta describes this file; forked/sub-agent files repeat their parent's after it.
			const meta = asObject(records.find((record) => record.type === 'session_meta')?.payload);
			const sessionId = asString(meta.session_id) ?? asString(meta.id);
			if (sessionId && imported.has(sessionId)) continue;
			// Sub-agent turns are delegated work, not human prompts; their tokens still count.
			const isSubagent =
				(typeof meta.source === 'object' && meta.source !== null) ||
				meta.thread_source === 'subagent' ||
				meta.thread_source === 'guardian_review';
			let cwd = asString(meta.cwd);

			for (const record of records) {
				const payload = asObject(record.payload);
				if (record.type === 'session_meta') continue;
				if (record.type === 'turn_context' && payload.cwd) cwd = asString(payload.cwd);

				const key = keyOfTimestamp(asString(record.timestamp));
				if (!key || key < since) continue;

				const responseId = asString(payload.response_id);
				const info = asObject(payload.info);
				if (record.type === 'token_usage_record' && responseId && !seenResponses.has(responseId)) {
					seenResponses.add(responseId);
					day(days, key).tokens.codex += fresh(payload.usage);
				} else if (!hasUsageRecords && record.type === 'event_msg' && payload.type === 'token_count' && payload.info) {
					const total = asNumber(asObject(info.total_token_usage).total_tokens);
					if (total === lastTotal) continue;
					lastTotal = total;
					day(days, key).tokens.codex += fresh(info.last_token_usage);
				} else if (record.type === 'event_msg' && payload.type === 'task_started' && !isSubagent) {
					const aggregate = day(days, key);
					aggregate.prompts.codex++;
					if (sessionId) aggregate.sessions.codex.add(sessionId);
					bumpProject(aggregate, cwd);
				}
			}
		}
	}
	return files;
}
