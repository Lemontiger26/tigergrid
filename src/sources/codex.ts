import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bumpProject, day, keyOfTimestamp, readJsonl, type Days } from '../days';

const CODEX = join(homedir(), '.codex');
const ROOTS = ['sessions', 'archived_sessions'].map((d) => join(CODEX, d));

/** Threads Codex imported from other agents (e.g. Claude Code); those are counted at their source. */
async function importedThreadIds(): Promise<Set<string>> {
	try {
		const ledger = await Bun.file(join(CODEX, 'external_agent_session_imports.json')).json();
		return new Set((ledger.records ?? []).map((r: any) => r.imported_thread_id).filter(Boolean));
	} catch {
		return new Set();
	}
}

const fresh = (u: any): number =>
	Math.max(0, (u?.input_tokens ?? 0) - (u?.cached_input_tokens ?? 0)) + (u?.output_tokens ?? 0);

export async function loadCodex(days: Days, since: string): Promise<number> {
	const imported = await importedThreadIds();
	let files = 0;
	for (const root of ROOTS) {
		if (!existsSync(root)) continue;
		for await (const rel of new Glob('**/*.jsonl').scan({ cwd: root, onlyFiles: true })) {
			files++;
			const records: any[] = [];
			for await (const r of readJsonl(join(root, rel))) records.push(r);

			// Newer rollouts log one token_usage_record per response; older ones only
			// emit token_count events, which can repeat the same totals.
			const hasUsageRecords = records.some((r) => r.type === 'token_usage_record');
			const seenResponses = new Set<string>();
			let lastTotal = -1;
			// The first session_meta describes this file; forked/sub-agent files repeat their parent's after it.
			const meta = records.find((r) => r.type === 'session_meta')?.payload ?? {};
			const sessionId: string | undefined = meta.session_id ?? meta.id;
			if (sessionId && imported.has(sessionId)) continue;
			// Sub-agent turns are delegated work, not human prompts; their tokens still count.
			const isSubagent =
				typeof meta.source === 'object' ||
				meta.thread_source === 'subagent' ||
				meta.thread_source === 'guardian_review';
			let cwd: string | undefined = meta.cwd;

			for (const r of records) {
				const p = r.payload ?? {};
				if (r.type === 'session_meta') continue;
				if (r.type === 'turn_context' && p.cwd) cwd = p.cwd;

				const key = keyOfTimestamp(r.timestamp);
				if (!key || key < since) continue;

				if (r.type === 'token_usage_record' && p.response_id && !seenResponses.has(p.response_id)) {
					seenResponses.add(p.response_id);
					day(days, key).tokens.codex += fresh(p.usage);
				} else if (!hasUsageRecords && r.type === 'event_msg' && p.type === 'token_count' && p.info) {
					const total = p.info.total_token_usage?.total_tokens ?? 0;
					if (total === lastTotal) continue;
					lastTotal = total;
					day(days, key).tokens.codex += fresh(p.info.last_token_usage);
				} else if (r.type === 'event_msg' && p.type === 'task_started' && !isSubagent) {
					const d = day(days, key);
					d.prompts.codex++;
					if (sessionId) d.sessions.codex.add(sessionId);
					bumpProject(d, cwd);
				}
			}
		}
	}
	return files;
}
