import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonDay } from '../types/cli';
import { buildGitFixture } from './helpers/git-fixture';

// End-to-end: run the real CLI against all fixtures. The window is 520 weeks so the
// fixture dates stay inside it for years; the old 2026-08-01 records are therefore included.
const git = buildGitFixture();
const out = mkdtempSync(join(tmpdir(), 'tigergrid-out-'));
afterAll(() => {
	git.cleanup();
	rmSync(out, { recursive: true, force: true });
});

const FIXTURE_ARGS = [
	'-w',
	'520',
	'--claude-dir',
	'test/fixtures/claude',
	'--codex-dir',
	'test/fixtures/codex',
	'--git-root',
	git.root,
	'--author',
	'dev@acme.test'
];

/** Run the CLI with plain output; returns exit code, stdout and stderr. */
function cli(...args: string[]) {
	const result = Bun.spawnSync(['bun', 'src/cli.ts', ...args], { env: { ...process.env, NO_COLOR: '1' } });
	return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe('--json', () => {
	const { code, stdout } = cli('--json', ...FIXTURE_ARGS);
	// Our own --json output, whose shape types/cli.ts defines.
	const rows = JSON.parse(stdout) as JsonDay[];
	const byDate = Object.fromEntries(rows.map((result) => [result.date, result]));

	test('exits cleanly with one row per active day, sorted by date', () => {
		expect(code).toBe(0);
		expect(rows.map((result) => result.date)).toEqual([
			'2026-08-01',
			'2026-09-08',
			'2026-09-09',
			'2026-09-10',
			'2026-09-11',
			'2026-09-12'
		]);
	});

	test('merges all three sources per day', () => {
		expect(byDate['2026-09-09']).toEqual({
			date: '2026-09-09',
			sessions: { claude: 2, codex: 0 },
			prompts: { claude: 2, codex: 0 },
			tokens: { claude: 750, codex: 0 },
			commits: 1,
			aiCommits: 1,
			projects: { 'acme/api': 1, 'acme/web': 1 }
		});
		expect(byDate['2026-09-12']).toMatchObject({
			prompts: { claude: 0, codex: 1 },
			tokens: { claude: 0, codex: 1200 },
			commits: 1,
			aiCommits: 1
		});
	});
});

describe('terminal output', () => {
	const { code, stdout } = cli('-m', 'prompts', ...FIXTURE_ARGS);

	test('prints the headline and the per-source summary', () => {
		expect(code).toBe(0);
		expect(stdout).toContain('8 prompts in the last 520 weeks · Claude Code + Codex');
		expect(stdout).toMatch(/Claude Code\s+2 sessions · 5 prompts · 2,150 tokens/);
		expect(stdout).toMatch(/Codex\s+2 sessions · 3 prompts · 2,360 tokens/);
		expect(stdout).toMatch(/git\s+5 commits · 3 AI-assisted \(60%\)/);
		expect(stdout).toMatch(/top projects\s+acme\/api 6 · acme\/web 2/);
		expect(stdout).toContain('scanned 3 Claude + 4 Codex transcripts, 3 repos');
	});

	test('--tool claude hides the Codex line', () => {
		const result = cli('-t', 'claude', ...FIXTURE_ARGS);
		expect(result.stdout).toContain('5 prompts in the last 520 weeks · Claude Code');
		expect(result.stdout).not.toMatch(/Codex\s+\d+ sessions/);
	});
});

describe('--svg', () => {
	test('writes a git-titled SVG for git metrics', () => {
		const path = join(out, 'ai.svg');
		const result = cli('-m', 'ai', '--svg', path, ...FIXTURE_ARGS);
		expect(result.code).toBe(0);
		expect(existsSync(path)).toBe(true);
		const svg = readFileSync(path, 'utf8');
		expect(svg).toContain('Git activity');
		expect(svg).toContain('AI-assisted commits');
	});
});

describe('argument errors', () => {
	test('--help prints usage', () => {
		const result = cli('--help');
		expect(result.code).toBe(0);
		expect(result.stdout).toStartWith('TigerGrid — a contribution graph');
	});

	test('an unknown metric exits 1 with a message', () => {
		const result = cli('-m', 'vibes');
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('tigergrid: unknown metric "vibes"');
	});

	test('an unknown tool exits 1', () => {
		expect(cli('-t', 'cursor').code).toBe(1);
	});

	test('--weeks must be a positive integer', () => {
		expect(cli('-w', '0').stderr).toContain('--weeks must be a positive integer');
		expect(cli('-w', 'two').code).toBe(1);
	});
});
