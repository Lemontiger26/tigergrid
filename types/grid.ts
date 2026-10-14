import type { METRICS } from '../src/grid';
import type { Tool } from './days';

export type Metric = (typeof METRICS)[number];
export type ToolFilter = Tool | 'all';

/** Colour ramp for levels 0..4 (0 = no activity), per theme. */
export interface Palette {
	dark: string[];
	light: string[];
}

/** Card surface colours for one theme. */
export interface Theme {
	bg: string;
	border: string;
	fg: string;
	muted: string;
}

export interface Cell {
	key: string;
	date: Date;
	value: number;
	level: number;
	future: boolean;
}

export interface Grid {
	/** Week columns, each Monday..Sunday. */
	weeks: Cell[][];
	start: string;
	end: string;
}

export interface Summary {
	total: number;
	activeDays: number;
	totalDays: number;
	currentStreak: number;
	longestStreak: number;
	busiest: Cell | null;
}

/** How the terminal grid draws a day: `wide` (▆▆, gaps both ways) or `matrix` (▐█, dense). */
export type CellStyle = 'wide' | 'matrix';

/** Which colour ramp the terminal grid uses; detected from the terminal unless --theme is given. */
export type TerminalTheme = 'light' | 'dark';

export interface RenderOptions {
	cells: CellStyle;
	theme: TerminalTheme;
}
