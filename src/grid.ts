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

/** Dark and light ramps for levels 0..4 (0 = no activity). */
export const PALETTES: Record<Metric, { dark: string[]; light: string[] }> = {
	prompts: {
		dark: ['#21262d', '#0e4429', '#006d32', '#26a641', '#39d353'],
		light: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
	},
	sessions: {
		dark: ['#21262d', '#0c2d6b', '#1158c7', '#388bfd', '#79c0ff'],
		light: ['#ebedf0', '#b6d4fe', '#6ea8fe', '#2f6fdb', '#0b4aa8']
	},
	tokens: {
		dark: ['#21262d', '#5a2a00', '#9e4c00', '#e07b00', '#ffb340'],
		light: ['#ebedf0', '#ffd8a8', '#ffa94d', '#f76707', '#c2410c']
	},
	commits: {
		dark: ['#21262d', '#3b2e00', '#7a5d00', '#c9a400', '#f5d90a'],
		light: ['#ebedf0', '#fff3a3', '#ffe14d', '#e6b800', '#a37f00']
	},
	ai: {
		dark: ['#21262d', '#3c1e70', '#6e40c9', '#a371f7', '#d2a8ff'],
		light: ['#ebedf0', '#e2d1ff', '#c297ff', '#8957e5', '#5a32a3']
	}
};

const tools = (t: ToolFilter): Tool[] => (t === 'all' ? ['claude', 'codex'] : [t]);

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

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function gridStart(weeks: number, today = new Date()): Date {
	const mondayOffset = (today.getDay() + 6) % 7;
	return addDays(today, -mondayOffset - (weeks - 1) * 7);
}

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

	// GitHub-style quartiles over the active days in view.
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

export function summarize(grid: Grid): Summary {
	const cells = grid.weeks.flat().filter((c) => !c.future);
	let longest = 0;
	let run = 0;
	for (const c of cells) {
		run = c.value > 0 ? run + 1 : 0;
		longest = Math.max(longest, run);
	}
	// A quiet today doesn't break the streak yet.
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

export const fmt = (n: number): string =>
	n >= 1e9
		? `${(n / 1e9).toFixed(1)}B`
		: n >= 1e6
			? `${(n / 1e6).toFixed(1)}M`
			: n >= 1e4
				? `${(n / 1e3).toFixed(1)}k`
				: n.toLocaleString('en-US');

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Column index → month label, placed on the first week whose Monday is in a new month. */
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
