import { describe, expect, test } from 'bun:test';
import type { Days } from '../types/days';
import { day } from '../src/days';
import { buildGrid, summarize } from '../src/grid';
import { renderSvg } from '../src/render/svg';

// The terminal renderer decides on colour at import time; force plain output first.
process.env.NO_COLOR = '1';
const { renderBars, renderGrid } = await import('../src/render/terminal');

const TODAY = new Date(2026, 8, 12); // Saturday
const days: Days = new Map();
for (const [key, count] of Object.entries({
	'2026-09-08': 2,
	'2026-09-09': 2,
	'2026-09-10': 1,
	'2026-09-11': 1,
	'2026-09-12': 1
})) {
	day(days, key).prompts.claude = count;
}
const grid = buildGrid(days, 'prompts', 'all', 2, TODAY);

describe('renderGrid (no colour)', () => {
	// Weeks of Sun 08-30 and Sun 09-06, rows Sun..Sat. "Aug" is dropped (no room before "Sep").
	test('wide: three columns per week, gaps between days and weeks', () => {
		expect(renderGrid(grid, 'prompts', { cells: 'wide', theme: 'light' })).toBe(
			[
				'        Sep',
				'     ·  · ',
				'Mon  ·  · ',
				'     · ▓▓ ',
				'Wed  · ▓▓ ',
				'     · ░░ ',
				'Fri  · ░░ ',
				'     · ░░ '
			].join('\n')
		);
	});

	test('matrix (default): two columns per week, no legend', () => {
		expect(renderGrid(grid, 'prompts', { cells: 'matrix', theme: 'dark' })).toBe(
			['       Sep', '     · ·', 'Mon  · ·', '     · ▓', 'Wed  · ▓', '     · ░', 'Fri  · ░', '     · ░'].join('\n')
		);
	});

	test('future days are left blank', () => {
		const thursday = buildGrid(days, 'prompts', 'all', 1, new Date(2026, 8, 10));
		expect(renderGrid(thursday, 'prompts', { cells: 'matrix', theme: 'dark' }).split('\n').slice(-2)).toEqual([
			'Fri   ',
			'      '
		]);
	});
});

describe('renderBars (no colour)', () => {
	// A fresh copy: `new Map(days)` would share the Day objects with the other tests.
	const withCommits: Days = new Map();
	for (const [key, aggregate] of days) day(withCommits, key).prompts = { ...aggregate.prompts };
	day(withCommits, '2026-09-08').commits = 2;
	day(withCommits, '2026-09-09').commits = 1;
	const bars = (today: Date, weeks: number) =>
		renderBars(
			(['prompts', 'commits'] as const).map((metric) => [metric, buildGrid(withCommits, metric, 'all', weeks, today)]),
			{ theme: 'dark' }
		);

	test('one bar per metric per day, its height the level, then a legend', () => {
		// prompts levels 0,0,3,3,1,1,1 and commits 0,0,2,1,0,0,0 in the week of 09-06; · is level 0.
		expect(bars(TODAY, 2)).toBe(
			[
				'        Sep',
				'     ·· ··',
				'Mon  ·· ··',
				'     ·· ▆▄',
				'Wed  ·· ▆▂',
				'     ·· ▂·',
				'Fri  ·· ▂·',
				'     ·· ▂·',
				'',
				'    bars, left to right: prompts · commits'
			].join('\n')
		);
	});

	test('future days are left blank', () => {
		expect(
			bars(new Date(2026, 8, 10), 1)
				.split('\n')
				.slice(6, 8)
		).toEqual(['Fri    ', '       ']);
	});
});

describe('renderSvg', () => {
	const svg = renderSvg(grid, 'prompts', summarize(grid), 'Agent activity · A & B <test>');

	test('is a standalone SVG with a light default and a dark media query', () => {
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
		expect(svg).toContain('@media (prefers-color-scheme:dark)');
		expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
	});

	test('draws one cell per past day plus five legend swatches', () => {
		const cells = svg.match(/<rect class="l\d"/g) ?? [];
		expect(cells).toHaveLength(14 + 5);
	});

	test('gives each day a tooltip', () => {
		expect(svg).toContain('<title>2026-09-08: 2 prompts</title>');
		expect(svg).toContain('<title>2026-09-01: 0 prompts</title>');
		expect(svg).not.toContain('2026-09-13');
	});

	test('escapes the title and shows the summary', () => {
		expect(svg).toContain('Agent activity · A &#38; B &#60;test&#62;');
		expect(svg).toContain('<tspan class="v">7</tspan> prompts');
		expect(svg).toContain('<tspan class="v">5</tspan> active days');
	});
});

describe('renderSvg cell styles', () => {
	const render = (cells?: 'matrix' | 'wide') =>
		renderSvg(grid, 'prompts', summarize(grid), 'Agent activity', cells ? { cells } : {});

	test('matrix (default): square-cornered bars that join within a week, monospace text', () => {
		const svg = render();
		expect(svg).toBe(render('matrix'));
		// 09-08 sits in the second week (x 50 + 14 + offset 3) on Tuesday (y 80 + 2 × 14), 11 × 14 px, no rx
		expect(svg).toContain('<rect class="l3" x="67" y="108" width="11" height="14"><title>2026-09-08');
		// the next day starts exactly where this one ends: no gap between days
		expect(svg).toContain('<rect class="l3" x="67" y="122" width="11" height="14"><title>2026-09-09');
		expect(svg).toContain('ui-monospace');
		expect(svg).not.toContain(' rx="3"');
	});

	test('wide: rounded squares with gaps both ways, sans-serif text', () => {
		const svg = render('wide');
		expect(svg).toContain('<rect class="l3" x="64" y="108" width="11" height="11" rx="3"><title>2026-09-08');
		expect(svg).toContain('<rect class="l3" x="64" y="122" width="11" height="11" rx="3"><title>2026-09-09');
		expect(svg).toContain('Inter,');
		expect(svg).not.toContain('ui-monospace');
	});
});
