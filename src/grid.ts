import { dayKey, type Day, type Days, type Tool } from './days';

export const METRICS = ['prompts', 'sessions', 'tokens', 'commits', 'ai'] as const;
export type Metric = (typeof METRICS)[number];
export type ToolFilter = Tool | 'all';

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
export const THEME = {
	light: { bg: '#ffffff', border: '#e3e7eb', fg: '#1b2733', muted: '#6b7785' },
	dark: { bg: '#0b0c0c', border: '#1f2422', fg: '#f3f6f4', muted: '#8b938f' }
} as const;

/**
 * Level ramps 0..4 (0 = no activity) per metric. Light ramps run from a pastel tag fill to
 * its saturated tag text colour; dark ramps run from a dim tint to a neon accent.
 */
export const PALETTES: Record<Metric, { dark: string[]; light: string[] }> = {
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
 * Expand a tool filter to the concrete tools it covers.
 *
 * @returns `["claude", "codex"]` for "all", otherwise a single-element list.
 * Called by: value.
 * Calls: nothing.
 */
const tools = (t: ToolFilter): Tool[] => (t === 'all' ? ['claude', 'codex'] : [t]);

/**
 * Read one metric off a day's aggregate. Agent metrics are summed over the selected tools;
 * git metrics ignore the tool filter.
 *
 * @returns the metric value for that day, 0 for a day with no data.
 * Called by: buildGrid.
 * Calls: tools.
 */
export function value(d: Day | undefined, metric: Metric, tool: ToolFilter): number {
	if (!d) return 0;
	switch (metric) {
		case 'prompts':
			return tools(tool).reduce((n, t) => n + d.prompts[t], 0);
		case 'sessions':
			return tools(tool).reduce((n, t) => n + d.sessions[t].size, 0);
		case 'tokens':
			return tools(tool).reduce((n, t) => n + d.tokens[t], 0);
		case 'commits':
			return d.commits;
		case 'ai':
			return d.aiCommits;
	}
}

export interface Cell {
	key: string;
	date: Date;
	value: number;
	level: number;
	future: boolean;
}

export interface Grid {
	weeks: Cell[][]; // columns, Monday..Sunday
	start: string;
	end: string;
}

/**
 * Shift a date by whole calendar days at local midnight (safe across DST changes).
 *
 * @returns a new Date `n` days after `d` (before it for negative `n`).
 * Called by: gridStart, buildGrid.
 * Calls: nothing.
 */
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

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
 * Lay the aggregated days out as week columns (Mon..Sun), read the chosen metric for each
 * cell, and assign colour levels GitHub-style: quartiles over the active days in view, so
 * levels are relative to your own activity. Days after today are marked `future`.
 *
 * @returns the grid with per-cell values and levels, plus its start/end day keys.
 * Called by: cli.
 * Calls: gridStart, addDays, dayKey, value.
 */
export function buildGrid(days: Days, metric: Metric, tool: ToolFilter, weeks: number, today = new Date()): Grid {
	const start = gridStart(weeks, today);
	const todayKey = dayKey(today);
	const cols: Cell[][] = [];
	for (let w = 0; w < weeks; w++) {
		const col: Cell[] = [];
		for (let i = 0; i < 7; i++) {
			const date = addDays(start, w * 7 + i);
			const key = dayKey(date);
			col.push({ key, date, value: value(days.get(key), metric, tool), level: 0, future: key > todayKey });
		}
		cols.push(col);
	}

	const active = cols
		.flat()
		.map((c) => c.value)
		.filter((v) => v > 0)
		.sort((a, b) => a - b);
	const q = (p: number) => active[Math.min(active.length - 1, Math.floor(p * active.length))] ?? 0;
	const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
	for (const c of cols.flat()) {
		c.level = c.value <= 0 ? 0 : c.value <= q1 ? 1 : c.value <= q2 ? 2 : c.value <= q3 ? 3 : 4;
	}
	return { weeks: cols, start: dayKey(start), end: todayKey };
}

export interface Summary {
	total: number;
	activeDays: number;
	totalDays: number;
	currentStreak: number;
	longestStreak: number;
	busiest: Cell | null;
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
	const cells = grid.weeks.flat().filter((c) => !c.future);
	let longest = 0;
	let run = 0;
	for (const c of cells) {
		run = c.value > 0 ? run + 1 : 0;
		longest = Math.max(longest, run);
	}
	let current = 0;
	for (let i = cells.length - 1; i >= 0; i--) {
		if (cells[i]!.value > 0) current++;
		else if (i === cells.length - 1) continue;
		else break;
	}
	const busiest = cells.reduce<Cell | null>((b, c) => (c.value > (b?.value ?? 0) ? c : b), null);
	return {
		total: cells.reduce((n, c) => n + c.value, 0),
		activeDays: cells.filter((c) => c.value > 0).length,
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
export const fmt = (n: number): string =>
	n >= 1e9
		? `${(n / 1e9).toFixed(1)}B`
		: n >= 1e6
			? `${(n / 1e6).toFixed(1)}M`
			: n >= 1e4
				? `${(n / 1e3).toFixed(1)}k`
				: n.toLocaleString('en-US');

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
	let last = -1;
	grid.weeks.forEach((col, i) => {
		const m = col[0]!.date.getMonth();
		if (m !== last) labels.set(i, MONTHS[m]!);
		last = m;
	});
	return labels;
}
