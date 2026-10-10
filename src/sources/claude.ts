import { Glob } from 'bun';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bumpProject, day, keyOfTimestamp, readJsonl, type Days } from '../days';

const ROOT = join(homedir(), '.claude', 'projects');

/** A real human prompt, not a tool result, slash-command echo, or injected meta message. */
function isHumanPrompt(r: any): boolean {
	if (r.type !== 'user' || r.isMeta || r.isSidechain) return false;
	const kind = r.origin?.kind;
	if (kind && kind !== 'human') return false;
	const c = r.message?.content;
	if (typeof c === 'string') return !c.startsWith('<');
	if (Array.isArray(c)) return c.some((b: any) => b.type === 'text') && !c.some((b: any) => b.type === 'tool_result');
	return false;
}

export async function loadClaude(days: Days, since: string): Promise<number> {
	const seenMessages = new Set<string>();
	let files = 0;
	for await (const rel of new Glob('**/*.jsonl').scan({ cwd: ROOT, onlyFiles: true })) {
		files++;
		for await (const r of readJsonl(join(ROOT, rel))) {
			const key = keyOfTimestamp(r.timestamp);
			if (!key || key < since) continue;

			if (r.type === 'assistant' && r.message?.usage) {
				// One API response is split across several lines that all repeat the same usage.
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
