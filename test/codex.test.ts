import { beforeAll, describe, expect, test } from 'bun:test';
import type { Days } from '../src/days';
import { fresh, loadCodex } from '../src/sources/codex';

const HOME = 'test/fixtures/codex';
const SINCE = '2026-09-01';

describe('fresh', () => {
	test('is uncached input plus output', () => {
		expect(fresh({ input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 })).toBe(250);
	});

	test('never goes negative and tolerates missing fields', () => {
		expect(fresh({ input_tokens: 10, cached_input_tokens: 50, output_tokens: 0 })).toBe(0);
		expect(fresh({ output_tokens: 7 })).toBe(7);
		expect(fresh(undefined)).toBe(0);
	});
});

describe('loadCodex on the fixtures', () => {
	const days: Days = new Map();
	let files = 0;
	beforeAll(async () => {
		files = await loadCodex(days, SINCE, HOME);
	});

	test('scans sessions/ and archived_sessions/, imported files included', () => {
		expect(files).toBe(4);
	});

	test('skips the thread Codex imported from Claude Code entirely', () => {
		// Its timestamps are all 2026-09-20 (the import time); nothing may land there.
		expect(days.has('2026-09-20')).toBe(false);
		expect([...days.keys()].sort()).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
	});

	test("2026-09-10: one prompt; tokens from usage records, deduped, plus the sub-agent's", () => {
		const d = days.get('2026-09-10')!;
		expect(d.prompts.codex).toBe(1); // the sub-agent's task_started doesn't count
		// r1 (logged twice) 250 + r2 600 + sub-agent r9 300; the token_count event is ignored
		expect(d.tokens.codex).toBe(1150);
	});

	test('2026-09-11: a turn on the next day lands on the next day', () => {
		const d = days.get('2026-09-11')!;
		expect(d.prompts.codex).toBe(1);
		expect(d.tokens.codex).toBe(10);
	});

	test('2026-09-12: legacy rollout falls back to token_count and skips repeated totals', () => {
		const d = days.get('2026-09-12')!;
		expect(d.prompts.codex).toBe(1);
		expect(d.tokens.codex).toBe(700 + 500);
	});

	test("sessions come from the file's own session_meta, never the parent's copy", () => {
		expect([...days.get('2026-09-10')!.sessions.codex]).toEqual(['codex-native-1']);
		expect([...days.get('2026-09-11')!.sessions.codex]).toEqual(['codex-native-1']);
		expect([...days.get('2026-09-12')!.sessions.codex]).toEqual(['codex-legacy-1']);
	});

	test("attributes prompts to the session's cwd", () => {
		expect(Object.fromEntries(days.get('2026-09-10')!.projects)).toEqual({ 'acme/api': 1 });
		expect(Object.fromEntries(days.get('2026-09-12')!.projects)).toEqual({ 'acme/web': 1 });
	});
});

describe('loadCodex edge cases', () => {
	test("returns 0 when the Codex home doesn't exist", async () => {
		const days: Days = new Map();
		expect(await loadCodex(days, SINCE, 'test/fixtures/does-not-exist')).toBe(0);
		expect(days.size).toBe(0);
	});
});
