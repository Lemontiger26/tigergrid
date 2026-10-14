import { describe, expect, test } from 'bun:test';
import type { Days } from '../types/days';
import { day } from '../src/days';
import { buildGrid, summarize } from '../src/grid';
import { renderSvg } from '../src/render/svg';

// The terminal renderer decides on colour at import time; force plain output first.
process.env.NO_COLOR = '1';
const { renderGrid } = await import('../src/render/terminal');

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
	// Weeks of 08-31 and 09-07. "Aug" is dropped (no room before "Sep"); Sunday 09-13 is still in the future.
	test('wide: three columns per week, gaps between days and weeks', () => {
		expect(renderGrid(grid, 'prompts', { cells: 'wide', theme: 'light' })).toBe(
			[
				'        Sep',
				'Mon  ·  · ',
				'     · ▓▓ ',
				'Wed  · ▓▓ ',
				'     · ░░ ',
				'Fri  · ░░ ',
				'     · ░░ ',
				'     ·    '
			].join('\n')
		);
	});

	test('matrix (default): two columns per week, no legend', () => {
		expect(renderGrid(grid, 'prompts', { cells: 'matrix', theme: 'dark' })).toBe(
			['       Sep', 'Mon  · ·', '     · ▓', 'Wed  · ▓', '     · ░', 'Fri  · ░', '     · ░', '     ·  '].join('\n')
		);
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
		expect(cells).toHaveLength(13 + 5);
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
		// 09-08 sits in the second week (x 50 + 14 + offset 3) on Tuesday (y 80 + 14), 11 × 14 px, no rx
		expect(svg).toContain('<rect class="l3" x="67" y="94" width="11" height="14"><title>2026-09-08');
		// the next day starts exactly where this one ends: no gap between days
		expect(svg).toContain('<rect class="l3" x="67" y="108" width="11" height="14"><title>2026-09-09');
		expect(svg).toContain('ui-monospace');
		expect(svg).not.toContain(' rx="3"');
	});

	test('wide: rounded squares with gaps both ways, sans-serif text', () => {
		const svg = render('wide');
		expect(svg).toContain('<rect class="l3" x="64" y="94" width="11" height="11" rx="3"><title>2026-09-08');
		expect(svg).toContain('<rect class="l3" x="64" y="108" width="11" height="11" rx="3"><title>2026-09-09');
		expect(svg).toContain('Inter,');
		expect(svg).not.toContain('ui-monospace');
	});
});
