import { describe, expect, test } from 'bun:test';
import { bumpProject, day, dayKey, keyOfTimestamp, projectName, readJsonl, type Days } from '../src/days';

// bun test runs in UTC unless TZ is set, so local day keys equal UTC dates here.

describe('dayKey', () => {
	test('formats a local date as YYYY-MM-DD with zero padding', () => {
		expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
		expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
	});
});

describe('keyOfTimestamp', () => {
	test('turns an ISO timestamp into its day key', () => {
		expect(keyOfTimestamp('2026-09-08T10:00:00Z')).toBe('2026-09-08');
	});

	test('returns null for missing or unparseable timestamps', () => {
		expect(keyOfTimestamp(undefined)).toBeNull();
		expect(keyOfTimestamp('')).toBeNull();
		expect(keyOfTimestamp('not a date')).toBeNull();
	});
});

describe('day', () => {
	test('creates an empty aggregate on first touch and returns the same one afterwards', () => {
		const days: Days = new Map();
		const first = day(days, '2026-09-08');
		expect(first).toEqual({
			sessions: { claude: new Set(), codex: new Set() },
			prompts: { claude: 0, codex: 0 },
			tokens: { claude: 0, codex: 0 },
			commits: 0,
			aiCommits: 0,
			projects: new Map()
		});
		first.commits = 3;
		expect(day(days, '2026-09-08').commits).toBe(3);
		expect(days.size).toBe(1);
	});
});

describe('projectName', () => {
	test('keeps the last two path segments', () => {
		expect(projectName('/Users/dev/acme/api')).toBe('acme/api');
		expect(projectName('/Users/dev/acme/api/')).toBe('acme/api');
		expect(projectName('/solo')).toBe('solo');
	});

	test('returns null for an empty or missing cwd', () => {
		expect(projectName(undefined)).toBeNull();
		expect(projectName('')).toBeNull();
		expect(projectName('/')).toBeNull();
	});
});

describe('bumpProject', () => {
	test('counts prompts per project and ignores unknown cwds', () => {
		const d = day(new Map(), '2026-09-08');
		bumpProject(d, '/Users/dev/acme/api');
		bumpProject(d, '/Users/dev/acme/api');
		bumpProject(d, '/Users/dev/acme/web');
		bumpProject(d, undefined);
		expect(Object.fromEntries(d.projects)).toEqual({ 'acme/api': 2, 'acme/web': 1 });
	});
});

describe('readJsonl', () => {
	test('yields every parseable line and skips the truncated last one', async () => {
		const records = [];
		for await (const r of readJsonl('test/fixtures/claude/-Users-dev-acme-api/claude-api-1.jsonl')) records.push(r);
		// The fixture has 13 lines; the 13th is cut off mid-write.
		expect(records).toHaveLength(12);
		expect(records.at(-1).message.content[0].text).toBe('Shipped.');
	});
});
