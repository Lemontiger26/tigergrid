import { beforeAll, describe, expect, test } from 'bun:test';
import type { Days } from '../src/days';
import { isHumanPrompt, loadClaude } from '../src/sources/claude';

const ROOT = 'test/fixtures/claude';
const SINCE = '2026-09-01';

describe('isHumanPrompt', () => {
	const user = (extra: object) => ({ type: 'user', message: { role: 'user', content: 'hi' }, ...extra });

	test('accepts typed prompts, as a string or as text blocks', () => {
		expect(isHumanPrompt(user({ origin: { kind: 'human' } }))).toBe(true);
		expect(isHumanPrompt(user({}))).toBe(true);
		expect(isHumanPrompt(user({ message: { content: [{ type: 'text', text: 'hi' }] } }))).toBe(true);
	});

	test('rejects everything that only looks like a user message', () => {
		expect(isHumanPrompt({ type: 'assistant', message: { content: 'hi' } })).toBe(false);
		expect(isHumanPrompt(user({ isMeta: true }))).toBe(false);
		expect(isHumanPrompt(user({ isSidechain: true }))).toBe(false);
		expect(isHumanPrompt(user({ origin: { kind: 'task-notification' } }))).toBe(false);
		expect(isHumanPrompt(user({ message: { content: '<command-name>/model</command-name>' } }))).toBe(false);
		expect(isHumanPrompt(user({ message: { content: [{ type: 'tool_result', content: 'ok' }] } }))).toBe(false);
		expect(isHumanPrompt(user({ message: {} }))).toBe(false);
	});
});

describe('loadClaude on the fixtures', () => {
	const days: Days = new Map();
	let files = 0;
	beforeAll(async () => {
		files = await loadClaude(days, SINCE, ROOT);
	});

	test('scans every transcript, including sub-agent files', () => {
		expect(files).toBe(3);
	});

	test('ignores records before `since`', () => {
		expect(days.has('2026-08-01')).toBe(false);
		expect([...days.keys()].sort()).toEqual(['2026-09-08', '2026-09-09']);
	});

	test('2026-09-08: two real prompts out of seven user records', () => {
		expect(days.get('2026-09-08')!.prompts.claude).toBe(2);
	});

	test('2026-09-08: fresh tokens count a split response once and skip cache reads', () => {
		// msg_A1 (two lines, one response): 100 + 1000 + 200 = 1300
		// msg_A2:                            10 +    0 +  90 =  100
		expect(days.get('2026-09-08')!.tokens.claude).toBe(1400);
	});

	test("2026-09-09: sub-agent tokens count, sub-agent prompts don't", () => {
		const d = days.get('2026-09-09')!;
		expect(d.prompts.claude).toBe(2); // "Ship it" + "Fix the navbar"
		expect(d.tokens.claude).toBe(50 + 200 + 500); // msg_A3 + msg_W1 + sub-agent msg_W2
	});

	test('tracks distinct sessions per day', () => {
		expect([...days.get('2026-09-08')!.sessions.claude]).toEqual(['claude-api-1']);
		expect([...days.get('2026-09-09')!.sessions.claude].sort()).toEqual(['claude-api-1', 'claude-web-1']);
	});

	test('attributes prompts to the project they ran in', () => {
		expect(Object.fromEntries(days.get('2026-09-08')!.projects)).toEqual({ 'acme/api': 2 });
		expect(Object.fromEntries(days.get('2026-09-09')!.projects)).toEqual({ 'acme/api': 1, 'acme/web': 1 });
	});

	test('leaves Codex and git counters alone', () => {
		for (const d of days.values()) {
			expect(d.prompts.codex).toBe(0);
			expect(d.commits).toBe(0);
		}
	});
});

describe('loadClaude edge cases', () => {
	test("returns 0 and loads nothing when the directory doesn't exist", async () => {
		const days: Days = new Map();
		expect(await loadClaude(days, SINCE, 'test/fixtures/does-not-exist')).toBe(0);
		expect(days.size).toBe(0);
	});

	test('an earlier `since` pulls in the old record', async () => {
		const days: Days = new Map();
		await loadClaude(days, '2026-01-01', ROOT);
		expect(days.get('2026-08-01')!.prompts.claude).toBe(1);
	});
});
