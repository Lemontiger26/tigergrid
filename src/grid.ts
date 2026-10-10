import type { Day, Days, Tool } from '../types/days';
import type { Cell, Grid, Metric, Palette, Summary, Theme, ToolFilter } from '../types/grid';
import { dayKey } from './days';

export const METRICS = ['prompts', 'sessions', 'tokens', 'commits', 'ai'] as const;

export const METRIC_LABEL: Record<Metric, string> = {
	prompts: 'prompts',
	sessions: 'agent sessions',
	tokens: 'tokens',
	commits: 'commits',
	ai: 'AI-assisted commits'
};

/**
 * Surface colours for the two themes. Light follows a clean admin UI (white card on a cool
 * grey page, slate text); dark follows a near-black fintech dashboard (black canvas, charcoal
 * cards, soft grey-green muted text).
 */
export const THEME: Record<'light' | 'dark', Theme> = {
	light: { bg: '#ffffff', border: '#e3e7eb', fg: '#1b2733', muted: '#6b7785' },
	dark: { bg: '#0b0c0c', border: '#1f2422', fg: '#f3f6f4', muted: '#8b938f' }
};

/**
 * Level ramps 0..4 (0 = no activity) per metric. Light ramps run from a pastel tag fill to
 * its saturated tag text colour; dark ramps run from a dim tint to a neon accent.
 */
export const PALETTES: Record<Metric, Palette> = {
	prompts: {
		// lime: the neon accent of the dark sample, the OUEST tag of the light one
		dark: ['#222725', '#2a3a16', '#4f7a13', '#8fd12a', '#c4f54a'],
		light: ['#eef1f4', '#e6f8c2', '#c2e870', '#8cc51e', '#5f8d0b']
	},
	sessions: {
		// blue: the export button / heatmap blues
		dark: ['#222725', '#1a2550', '#26408f', '#3667e6', '#7fa3ff'],
		light: ['#eef1f4', '#dfeaff', '#a9c6ff', '#4f82f2', '#1f5fe0']
	},
	tokens: {
		// violet: the CENTRE OUEST tag / the Stocks card
		dark: ['#222725', '#2a1d4d', '#4a2f8f', '#8b5cf6', '#c3a2ff'],
		light: ['#eef1f4', '#ece2ff', '#cfb5ff', '#9a64f5', '#6d32d9']
	},
	commits: {
		// mint: the NORD tag / the green cashflow band
		dark: ['#222725', '#12322b', '#17604f', '#1fb08f', '#5ee9c5'],
		light: ['#eef1f4', '#d5f5ec', '#94e3cf', '#2fb79a', '#0f7f6d']
	},
	ai: {
		// rose: the CENTRE-EST tag
		dark: ['#222725', '#3d1626', '#702447', '#d63d7c', '#ff8db8'],
		light: ['#eef1f4', '#fde2eb', '#f7afc6', '#e65588', '#b8245a']
	}
};

/**
 * Check that a CLI string names a metric.
 *
 * @returns true (narrowing the type) when `value` is one of METRICS.
 * Called by: cli.
 * Calls: nothing.
 */
export const isMetric = (value: string): value is Metric => METRICS.some((metric) => metric === value);

/**
 * Check that a CLI string names a tool filter.
 *
 * @returns true (narrowing the type) for "claude", "codex" or "all".
 * Called by: cli.
 * Calls: nothing.
 */
export const isToolFilter = (value: string): value is ToolFilter =>
	value === 'claude' || value === 'codex' || value === 'all';

/**
 * Expand a tool filter to the concrete tools it covers.
 *
 * @returns `["claude", "codex"]` for "all", otherwise a single-element list.
 * Called by: value.
 * Calls: nothing.
 */
const tools = (filter: ToolFilter): Tool[] => (filter === 'all' ? ['claude', 'codex'] : [filter]);

/**
 * Read one metric off a day's aggregate. Agent metrics are summed over the selected tools;
 * git metrics ignore the tool filter.
 *
 * @returns the metric value for that day, 0 for a day with no data.
 * Called by: buildGrid.
 * Calls: tools.
 */
export function value(aggregate: Day | undefined, metric: Metric, filter: ToolFilter): number {
	if (!aggregate) return 0;
	switch (metric) {
		case 'prompts':
			return tools(filter).reduce((sum, tool) => sum + aggregate.prompts[tool], 0);
		case 'sessions':
			return tools(filter).reduce((sum, tool) => sum + aggregate.sessions[tool].size, 0);
		case 'tokens':
			return tools(filter).reduce((sum, tool) => sum + aggregate.tokens[tool], 0);
		case 'commits':
			return aggregate.commits;
		case 'ai':
			return aggregate.aiCommits;
	}
}

/**
 * Shift a date by whole calendar days at local midnight (safe across DST changes).
 *
 * @returns a new Date `count` days after `date` (before it for a negative count).
 * Called by: gridStart, buildGrid.
 * Calls: nothing.
 */
const addDays = (date: Date, count: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);

/**
 * Find the Monday that starts a grid of `weeks` columns ending with the current week.
 * The CLI also uses it as the lower bound for what the sources load.
 *
 * @returns the first (top-left) date of the grid.
 * Called by: buildGrid, cli.
 * Calls: addDays.
 */
export function gridStart(weeks: number, today = new Date()): Date {
	const mondayOffset = (today.getDay() + 6) % 7;
	return addDays(today, -mondayOffset - (weeks - 1) * 7);
}

/**
 * Map a cell value to its colour level, given the quartile thresholds of the active days.
 *
 * @returns 0 for no activity, otherwise 1..4.
 * Called by: buildGrid.
 * Calls: nothing.
 */
function levelOf(cellValue: number, [q1, q2, q3]: [number, number, number]): number {
	if (cellValue <= 0) return 0;
	if (cellValue <= q1) return 1;
	if (cellValue <= q2) return 2;
	if (cellValue <= q3) return 3;
	return 4;
}

/**
 * Lay the aggregated days out as week columns (Mon..Sun), read the chosen metric for each
 * cell, and assign colour levels GitHub-style: quartiles over the active days in view, so
 * levels are relative to your own activity. Days after today are marked `future`.
 *
 * @returns the grid with per-cell values and levels, plus its start/end day keys.
 * Called by: cli.
 * Calls: gridStart, addDays, dayKey, value, levelOf.
 */
export function buildGrid(days: Days, metric: Metric, filter: ToolFilter, weeks: number, today = new Date()): Grid {
	const start = gridStart(weeks, today);
	const todayKey = dayKey(today);
	const columns: Cell[][] = [];
	for (let week = 0; week < weeks; week++) {
		const column: Cell[] = [];
		for (let weekday = 0; weekday < 7; weekday++) {
			const date = addDays(start, week * 7 + weekday);
			const key = dayKey(date);
			column.push({ key, date, value: value(days.get(key), metric, filter), level: 0, future: key > todayKey });
		}
		columns.push(column);
	}

	const active = columns
		.flat()
		.map((cell) => cell.value)
		.filter((cellValue) => cellValue > 0)
		.sort((left, right) => left - right);
	const quantile = (fraction: number) => active[Math.min(active.length - 1, Math.floor(fraction * active.length))] ?? 0;
	const thresholds: [number, number, number] = [quantile(0.25), quantile(0.5), quantile(0.75)];
	for (const cell of columns.flat()) cell.level = levelOf(cell.value, thresholds);
	return { weeks: columns, start: dayKey(start), end: todayKey };
}

/**
 * Compute headline stats for a grid: total, active days, current and longest streak, and
 * the busiest day. A quiet *today* does not break the current streak, since the day isn't over.
 *
 * @returns a Summary over the non-future cells.
 * Called by: cli (terminal summary and SVG subtitle).
 * Calls: nothing.
 */
export function summarize(grid: Grid): Summary {
	const cells = grid.weeks.flat().filter((cell) => !cell.future);
	let longest = 0;
	let run = 0;
	for (const cell of cells) {
		run = cell.value > 0 ? run + 1 : 0;
		longest = Math.max(longest, run);
	}
	let current = 0;
	for (let index = cells.length - 1; index >= 0; index--) {
		if (cells[index]!.value > 0) current++;
		else if (index === cells.length - 1) continue;
		else break;
	}
	const busiest = cells.reduce<Cell | null>((best, cell) => (cell.value > (best?.value ?? 0) ? cell : best), null);
	return {
		total: cells.reduce((sum, cell) => sum + cell.value, 0),
		activeDays: cells.filter((cell) => cell.value > 0).length,
		totalDays: cells.length,
		currentStreak: current,
		longestStreak: longest,
		busiest
	};
}

/**
 * Format a count compactly for display: `1,172`, `25.0k`, `115.2M`, `1.3B`.
 *
 * @returns the formatted number.
 * Called by: cli, render/svg.renderSvg.
 * Calls: nothing.
 */
export function fmt(count: number): string {
	if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`;
	if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
	if (count >= 1e4) return `${(count / 1e3).toFixed(1)}k`;
	return count.toLocaleString('en-US');
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Work out where month labels go above the grid: on each column whose Monday falls in a
 * different month than the previous column's.
 *
 * @returns a map of column index → short month name, in column order.
 * Called by: render/terminal.renderGrid, render/svg.renderSvg.
 * Calls: nothing.
 */
export function monthLabels(grid: Grid): Map<number, string> {
	const labels = new Map<number, string>();
	let lastMonth = -1;
	grid.weeks.forEach((column, index) => {
		const month = column[0]!.date.getMonth();
		if (month !== lastMonth) labels.set(index, MONTHS[month]!);
		lastMonth = month;
	});
	return labels;
}
