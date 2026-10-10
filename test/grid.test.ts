import { describe, expect, test } from 'bun:test';
import { day, type Days } from '../src/days';
import { buildGrid, fmt, gridStart, monthLabels, PALETTES, summarize, value } from '../src/grid';

// Fixture week: Mon 2026-09-07 .. Sun 2026-09-13. "Today" is Saturday 2026-09-12.
const TODAY = new Date(2026, 8, 12);

/** Build a Days map from `{ "YYYY-MM-DD": promptCount }`, all as Claude prompts. */
function promptDays(counts: Record<string, number>): Days {
	const days: Days = new Map();
	for (const [key, n] of Object.entries(counts)) day(days, key).prompts.claude = n;
	return days;
}

// Same per-day prompt totals the Claude + Codex fixtures produce together.
const FIXTURE_PROMPTS = { '2026-09-08': 2, '2026-09-09': 2, '2026-09-10': 1, '2026-09-11': 1, '2026-09-12': 1 };

describe('value', () => {
	const d = day(new Map(), '2026-09-09');
	d.prompts = { claude: 2, codex: 3 };
	d.tokens = { claude: 100, codex: 50 };
	d.sessions = { claude: new Set(['a', 'b']), codex: new Set(['c']) };
	d.commits = 4;
	d.aiCommits = 1;

	test('sums agent metrics over the selected tools', () => {
		expect(value(d, 'prompts', 'all')).toBe(5);
		expect(value(d, 'prompts', 'claude')).toBe(2);
		expect(value(d, 'tokens', 'codex')).toBe(50);
		expect(value(d, 'sessions', 'all')).toBe(3);
	});

	test('git metrics ignore the tool filter', () => {
		expect(value(d, 'commits', 'claude')).toBe(4);
		expect(value(d, 'ai', 'codex')).toBe(1);
	});

	test('a day without data is 0', () => {
		expect(value(undefined, 'tokens', 'all')).toBe(0);
	});
});

describe('gridStart', () => {
	test('starts on the Monday `weeks - 1` weeks before the current week', () => {
		expect(gridStart(1, TODAY)).toEqual(new Date(2026, 8, 7));
		expect(gridStart(2, TODAY)).toEqual(new Date(2026, 7, 31));
	});

	test('a Sunday still belongs to the week that started the Monday before', () => {
		expect(gridStart(1, new Date(2026, 8, 13))).toEqual(new Date(2026, 8, 7));
	});
});

describe('buildGrid', () => {
	const grid = buildGrid(promptDays(FIXTURE_PROMPTS), 'prompts', 'all', 2, TODAY);

	test('has one column per week, Monday to Sunday', () => {
		expect(grid.weeks).toHaveLength(2);
		expect(grid.weeks.map((col) => col.map((c) => c.key))).toEqual([
			['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'],
			['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']
		]);
		expect(grid.start).toBe('2026-08-31');
		expect(grid.end).toBe('2026-09-12');
	});

	test('marks days after today as future', () => {
		expect(grid.weeks[1]!.filter((c) => c.future).map((c) => c.key)).toEqual(['2026-09-13']);
	});

	test('reads the metric into each cell', () => {
		expect(grid.weeks[1]!.map((c) => c.value)).toEqual([0, 2, 2, 1, 1, 1, 0]);
	});

	test('levels are quartiles over active days: [1,1,1,2,2] puts 1 at level 1 and 2 at level 3', () => {
		expect(grid.weeks[1]!.map((c) => c.level)).toEqual([0, 3, 3, 1, 1, 1, 0]);
	});

	test('a wide spread uses all four levels', () => {
		const spread = buildGrid(
			promptDays({
				'2026-09-07': 1,
				'2026-09-08': 2,
				'2026-09-09': 3,
				'2026-09-10': 4,
				'2026-09-11': 5,
				'2026-09-12': 100
			}),
			'prompts',
			'all',
			1,
			TODAY
		);
		// sorted [1,2,3,4,5,100] → q1 = 2, q2 = 4, q3 = 5
		expect(spread.weeks[0]!.map((c) => c.level)).toEqual([1, 1, 2, 2, 3, 4, 0]);
	});
});

describe('summarize', () => {
	test('totals, active days, streaks and busiest day for the fixture week', () => {
		const s = summarize(buildGrid(promptDays(FIXTURE_PROMPTS), 'prompts', 'all', 2, TODAY));
		expect(s).toMatchObject({ total: 7, activeDays: 5, totalDays: 13, currentStreak: 5, longestStreak: 5 });
		expect(s.busiest?.key).toBe('2026-09-08'); // ties go to the earlier day
	});

	test("a quiet today doesn't break the current streak, a quiet yesterday does", () => {
		const quietToday = summarize(
			buildGrid(promptDays({ '2026-09-10': 1, '2026-09-11': 1 }), 'prompts', 'all', 1, TODAY)
		);
		expect(quietToday.currentStreak).toBe(2);
		const quietYesterday = summarize(buildGrid(promptDays({ '2026-09-10': 1 }), 'prompts', 'all', 1, TODAY));
		expect(quietYesterday.currentStreak).toBe(0);
	});

	test('an empty grid has no busiest day', () => {
		const s = summarize(buildGrid(new Map(), 'prompts', 'all', 1, TODAY));
		expect(s).toMatchObject({ total: 0, activeDays: 0, currentStreak: 0, longestStreak: 0, busiest: null });
	});
});

describe('fmt', () => {
	test('uses separators below 10k and compact units above', () => {
		expect(fmt(7)).toBe('7');
		expect(fmt(9999)).toBe('9,999');
		expect(fmt(25_000)).toBe('25.0k');
		expect(fmt(115_200_000)).toBe('115.2M');
		expect(fmt(1_300_000_000)).toBe('1.3B');
	});
});

describe('monthLabels', () => {
	test('labels the first column of each month', () => {
		const grid = buildGrid(new Map(), 'prompts', 'all', 6, TODAY);
		// Columns start Mon 08-03, 08-10, 08-17, 08-24, 08-31, 09-07: 08-31 is still August.
		expect([...monthLabels(grid)]).toEqual([
			[0, 'Aug'],
			[5, 'Sep']
		]);
	});
});

describe('PALETTES', () => {
	test('every metric has five valid hex colours per theme', () => {
		for (const { light, dark } of Object.values(PALETTES)) {
			for (const ramp of [light, dark]) {
				expect(ramp).toHaveLength(5);
				for (const c of ramp) expect(c).toMatch(/^#[0-9a-f]{6}$/);
			}
		}
	});
});
