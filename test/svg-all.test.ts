import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `bun run svg:all` = scripts/svg-all.ts: one SVG per metric (or per -m metric, plus their
// combined graph), extra flags passed to every run.
const FIXTURES = ['--no-git', '--claude-dir', 'test/fixtures/claude', '--codex-dir', 'test/fixtures/codex'];
const METRIC_FILES = ['ai', 'commits', 'prompts', 'sessions', 'tokens'].map((metric) => `tigergrid-${metric}.svg`);
let dir = '';

/** Run the script into a fresh temp dir; returns exit code, stdout and stderr. */
function svgAll(...args: string[]) {
	dir = mkdtempSync(join(tmpdir(), 'tigergrid-svg-all-'));
	const result = Bun.spawnSync(['bun', 'scripts/svg-all.ts', ...args], {
		env: { ...process.env, TIGERGRID_SVG_DIR: dir, NO_COLOR: '1' }
	});
	return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/** Read one written SVG from the current temp dir. */
const svg = (name: string) => readFileSync(join(dir, name), 'utf8');

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('svg:all', () => {
	test('writes one SVG per metric, matrix and 53 weeks by default', () => {
		const result = svgAll(...FIXTURES);
		expect(result.code).toBe(0);
		expect(readdirSync(dir).sort()).toEqual(METRIC_FILES);
		expect(result.stdout.trim().split('\n')).toHaveLength(5);
		for (const name of METRIC_FILES) {
			expect(svg(name)).toContain('ui-monospace');
			// 53 week columns: LEFT 50 + 53 × 14 + PAD 20 + 10
			expect(svg(name)).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" width="822"');
		}
		expect(svg('tigergrid-tokens.svg')).toContain('tokens');
		expect(svg('tigergrid-ai.svg')).toContain('Git activity');
	});

	test('passes extra flags to every run', () => {
		expect(svgAll('--cells', 'wide', '-t', 'claude', ...FIXTURES).code).toBe(0);
		for (const name of METRIC_FILES) {
			expect(svg(name)).toContain(' rx="3"');
			expect(svg(name)).not.toContain('ui-monospace');
		}
		expect(svg('tigergrid-prompts.svg')).toContain('Agent activity · Claude Code<');
	});

	test('-w overrides the default 53 weeks', () => {
		expect(svgAll('-w', '8', ...FIXTURES).code).toBe(0);
		// LEFT 50 + 8 × 14 + PAD 20 + 10
		expect(svg('tigergrid-prompts.svg')).toContain('width="192"');
	});

	test('-m limits the run to the listed metrics and adds their combined graph', () => {
		const result = svgAll('-m', 'prompts,sessions,tokens', ...FIXTURES);
		expect(result.code).toBe(0);
		expect(readdirSync(dir).sort()).toEqual([
			'tigergrid-prompts-sessions-tokens.svg',
			'tigergrid-prompts.svg',
			'tigergrid-sessions.svg',
			'tigergrid-tokens.svg'
		]);
		expect(svg('tigergrid-prompts-sessions-tokens.svg')).toContain(
			'<title>2026-09-08: 2 prompts · 1 agent sessions · 1,400 tokens</title>'
		);
		expect(svg('tigergrid-tokens.svg')).toContain('<title>2026-09-08: 1,400 tokens</title>');
	});

	test.each([
		['--metric=tokens', ['tigergrid-tokens.svg']],
		['-mai,ai', ['tigergrid-ai.svg']]
	])('%s: one metric, so no combined graph', (flag, files) => {
		expect(svgAll(flag, ...FIXTURES).code).toBe(0);
		expect(readdirSync(dir)).toEqual(files);
	});

	test('an unknown metric fails before anything is written', () => {
		const result = svgAll('--metric', 'prompts,vibes', ...FIXTURES);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('svg:all: unknown metric "vibes"');
		expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
	});

	test.each(['--svg', '--json'])('rejects %s, which it sets per run, and writes nothing', (flag) => {
		const result = svgAll(flag, 'x', ...FIXTURES);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(`svg:all: ${flag} is set per run`);
		expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
	});
});
