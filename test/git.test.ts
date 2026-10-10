import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Days } from '../src/days';
import { loadGit } from '../src/sources/git';
import { buildGitFixture } from './helpers/git-fixture';

const SINCE = '2026-09-01';
const ME = ['dev@acme.test'];

describe('loadGit on the fixture repos', () => {
	const fixture = buildGitFixture();
	const days: Days = new Map();
	let repos = 0;
	beforeAll(async () => {
		repos = await loadGit(days, SINCE, [fixture.root], ME);
	});
	afterAll(() => fixture.cleanup());

	test('finds acme/api, acme/web and the clone; skips node_modules and repos past depth 4', () => {
		expect(repos).toBe(3);
	});

	test('counts only my commits inside the window, each hash once despite the clone', () => {
		const commits = Object.fromEntries([...days].map(([k, d]) => [k, d.commits]));
		expect(commits).toEqual({ '2026-09-08': 2, '2026-09-09': 1, '2026-09-12': 1 });
	});

	test("flags Co-Authored-By trailers and 'Generated with' footers as AI-assisted", () => {
		const ai = Object.fromEntries([...days].map(([k, d]) => [k, d.aiCommits]));
		// 09-08: Claude trailer (the README typo fix is human), 09-09: Claude Code footer, 09-12: Codex trailer
		expect(ai).toEqual({ '2026-09-08': 1, '2026-09-09': 1, '2026-09-12': 1 });
	});

	test("without an author filter, the colleague's commit shows up too", async () => {
		const all: Days = new Map();
		await loadGit(all, SINCE, [fixture.root], []);
		expect(all.get('2026-09-09')!.commits).toBe(2);
	});

	test('leaves agent counters alone', () => {
		for (const d of days.values()) {
			expect(d.prompts).toEqual({ claude: 0, codex: 0 });
			expect(d.tokens).toEqual({ claude: 0, codex: 0 });
		}
	});
});

describe('loadGit edge cases', () => {
	test("ignores roots that don't exist", async () => {
		const days: Days = new Map();
		expect(await loadGit(days, SINCE, ['test/fixtures/does-not-exist'], ME)).toBe(0);
		expect(days.size).toBe(0);
	});
});
