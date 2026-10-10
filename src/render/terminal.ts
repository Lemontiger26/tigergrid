import { monthLabels, PALETTES, type Grid, type Metric } from '../grid';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const RESET = '\x1b[0m';
const MONO = [' ·', ' ░', ' ▒', ' ▓', ' █'];
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/**
 * Wrap text in ANSI dim, or leave it plain when stdout isn't a colour TTY.
 *
 * @returns the possibly-styled string.
 * Called by: renderGrid, cli.
 * Calls: nothing.
 */
export const dim = (s: string) => (color ? `\x1b[2m${s}${RESET}` : s);

/**
 * Wrap text in ANSI bold, or leave it plain when stdout isn't a colour TTY.
 *
 * @returns the possibly-styled string.
 * Called by: cli.
 * Calls: nothing.
 */
export const bold = (s: string) => (color ? `\x1b[1m${s}${RESET}` : s);

/**
 * Colour text with a 24-bit foreground from a `#rrggbb` hex string.
 *
 * @returns the string wrapped in truecolor escape codes, or unchanged without colour.
 * Called by: cell.
 * Calls: nothing.
 */
function fg(hex: string, s: string): string {
	if (!color) return s;
	const n = parseInt(hex.slice(1), 16);
	return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}${RESET}`;
}

/**
 * Draw one two-character grid cell: a square in the metric's dark-theme colour for `level`,
 * or a shade character (· ░ ▒ ▓ █) when colour is off (pipes, NO_COLOR).
 *
 * @returns the cell string, always two columns wide.
 * Called by: renderGrid.
 * Calls: fg.
 */
const cell = (metric: Metric, level: number) => (color ? fg(PALETTES[metric].dark[level]!, ' ■') : MONO[level]!);

/**
 * Render the grid for the terminal: a month header, seven weekday rows (Mon..Sun) with two
 * characters per week, and a Less→More legend. Month labels that would collide with the
 * next one are dropped; future days are left blank.
 *
 * @returns the multi-line string, ready to print.
 * Called by: cli.
 * Calls: monthLabels, cell, dim.
 */
export function renderGrid(grid: Grid, metric: Metric): string {
	const lines: string[] = [];

	const labels = [...monthLabels(grid)];
	let header = '    ';
	labels.forEach(([col, name], i) => {
		const next = labels[i + 1]?.[0] ?? Infinity;
		if (next - col < 2) return;
		header = header.padEnd(4 + col * 2) + ' ' + name;
	});
	lines.push(dim(header));

	for (let row = 0; row < 7; row++) {
		let line = dim(WEEKDAYS[row]!.padEnd(4));
		for (const col of grid.weeks) {
			const c = col[row]!;
			line += c.future ? '  ' : cell(metric, c.level);
		}
		lines.push(line);
	}

	const legend = [0, 1, 2, 3, 4].map((l) => cell(metric, l)).join('');
	lines.push('    ' + ' '.repeat(Math.max(0, grid.weeks.length * 2 - 16)) + dim('Less') + legend + dim(' More'));
	return lines.join('\n');
}
