import type { CellStyle, Grid, Metric, RenderOptions } from '../../types/grid';
import { monthLabels, PALETTES } from '../grid';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const RESET = '\x1b[0m';
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/**
 * Cell styles: the glyph drawn in colour, the shade characters used without colour (pipes,
 * NO_COLOR), the width in columns per week, and the spacing around the legend swatches (a
 * `wide` glyph carries its gap on the right, a `matrix` glyph on the left). `wide` leaves gaps
 * between days and weeks; `matrix` is denser: a gap between weeks only, so a busy week reads
 * as one bar.
 */
const CELLS: Record<CellStyle, { glyph: string; mono: string[]; width: number; legendGap: [string, string] }> = {
	wide: { glyph: '▆▆ ', mono: [' · ', '░░ ', '▒▒ ', '▓▓ ', '██ '], width: 3, legendGap: [' ', ''] },
	matrix: { glyph: '▐█', mono: [' ·', ' ░', ' ▒', ' ▓', ' █'], width: 2, legendGap: ['', ' '] }
};

/**
 * Check that a CLI string names a cell style.
 *
 * @returns true (narrowing the type) for "wide" or "matrix".
 * Called by: cli.
 * Calls: nothing.
 */
export const isCellStyle = (value: string): value is CellStyle => value === 'wide' || value === 'matrix';

/**
 * Columns one week takes in a cell style, so the CLI can fit the window to the terminal.
 *
 * @returns 3 for `wide`, 2 for `matrix`.
 * Called by: cli, renderGrid.
 * Calls: nothing.
 */
export const cellWidth = (style: CellStyle): number => CELLS[style].width;

/**
 * Wrap text in ANSI dim, or leave it plain when stdout isn't a colour TTY.
 *
 * @returns the possibly-styled string.
 * Called by: renderGrid, cli.
 * Calls: nothing.
 */
export const dim = (text: string) => (color ? `\x1b[2m${text}${RESET}` : text);

/**
 * Wrap text in ANSI bold, or leave it plain when stdout isn't a colour TTY.
 *
 * @returns the possibly-styled string.
 * Called by: cli.
 * Calls: nothing.
 */
export const bold = (text: string) => (color ? `\x1b[1m${text}${RESET}` : text);

/**
 * Colour text with a 24-bit foreground from a `#rrggbb` hex string.
 *
 * @returns the string wrapped in truecolor escape codes, or unchanged without colour.
 * Called by: cell.
 * Calls: nothing.
 */
function fg(hex: string, text: string): string {
	if (!color) return text;
	const rgb = parseInt(hex.slice(1), 16);
	return `\x1b[38;2;${(rgb >> 16) & 255};${(rgb >> 8) & 255};${rgb & 255}m${text}${RESET}`;
}

/**
 * Draw one grid cell: the style's glyph in the metric's colour for `level` from the light or
 * dark ramp, or the style's shade character when colour is off.
 *
 * @returns the cell string, always `cellWidth(options.cells)` columns wide.
 * Called by: renderGrid.
 * Calls: fg.
 */
function cell(metric: Metric, level: number, options: RenderOptions): string {
	const style = CELLS[options.cells];
	return color ? fg(PALETTES[metric][options.theme][level]!, style.glyph) : style.mono[level]!;
}

/**
 * Render the grid for the terminal: a month header, seven weekday rows (Mon..Sun) with one
 * cell per week, and a Less→More legend aligned to the grid's right edge. Month labels that
 * would collide with the next one are dropped; future days are left blank.
 *
 * @returns the multi-line string, ready to print.
 * Called by: cli.
 * Calls: monthLabels, cell, cellWidth, dim.
 */
export function renderGrid(grid: Grid, metric: Metric, options: RenderOptions): string {
	const width = cellWidth(options.cells);
	const lines: string[] = [];

	const labels = [...monthLabels(grid)];
	let header = '    ';
	labels.forEach(([column, name], index) => {
		const next = labels[index + 1]?.[0] ?? Infinity;
		// A label takes 4 characters (space + 3 letters); skip it if the next one starts sooner.
		if ((next - column) * width < 4) return;
		header = header.padEnd(4 + column * width) + ' ' + name;
	});
	lines.push(dim(header));

	for (let row = 0; row < 7; row++) {
		let line = dim(WEEKDAYS[row]!.padEnd(4));
		for (const column of grid.weeks) {
			const day = column[row]!;
			line += day.future ? ' '.repeat(width) : cell(metric, day.level, options);
		}
		lines.push(line);
	}

	const [before, after] = CELLS[options.cells].legendGap;
	const swatches = [0, 1, 2, 3, 4].map((level) => cell(metric, level, options)).join('');
	const legendWidth = 'Less'.length + before.length + 5 * width + after.length + 'More'.length;
	const indent = ' '.repeat(Math.max(0, grid.weeks.length * width - legendWidth));
	lines.push('    ' + indent + dim('Less') + before + swatches + after + dim('More'));
	return lines.join('\n');
}
