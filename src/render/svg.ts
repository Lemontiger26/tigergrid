import type { CellStyle, Grid, Metric, Summary, SvgOptions, Theme } from '../../types/grid';
import { fmt, METRIC_LABEL, monthLabels, PALETTES, THEME } from '../grid';

const PAD = 20;
const LEFT = PAD + 30;
const TOP = 80;
const SANS = "Inter,'General Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

/**
 * Cell geometry per style, mirroring the terminal: `matrix` draws square-cornered bars ¾ of a
 * column wide and a full row tall (like `▐█`), so the days of a week join into one strip with a
 * narrow gap between weeks, set in a monospace font; `wide` draws rounded squares with even
 * gaps. Whole-pixel values keep joined cells free of seams.
 */
const GEOMETRY: Record<CellStyle, { offsetX: number; width: number; height: number; radius: number; font: string }> = {
	matrix: { offsetX: 3, width: 11, height: 14, radius: 0, font: MONO },
	wide: { offsetX: 0, width: 11, height: 11, radius: 3, font: SANS }
};
const STEP_X = 14;
const STEP_Y = 14;

/**
 * Escape the characters that would break SVG text or attribute content.
 *
 * @returns the input with `& < > "` replaced by numeric entities.
 * Called by: renderSvg.
 * Calls: nothing.
 */
const esc = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * Turn a level ramp into CSS custom properties `--l0` … `--l4`, so one set of cell classes
 * can be recoloured per theme.
 *
 * @returns a CSS declaration list.
 * Called by: renderSvg.
 * Calls: nothing.
 */
const levelVars = (ramp: string[]) => ramp.map((hex, level) => `--l${level}:${hex};`).join('');

/**
 * Turn a THEME entry into the CSS custom properties for card background, border and text.
 *
 * @returns a CSS declaration list (`--bg`, `--border`, `--fg`, `--muted`).
 * Called by: renderSvg.
 * Calls: nothing.
 */
const surfaceVars = (theme: Theme) =>
	`--bg:${theme.bg};--border:${theme.border};--fg:${theme.fg};--muted:${theme.muted};`;

/**
 * Render the grid as a self-contained, embeddable SVG card: title, summary line, month and
 * weekday labels, one cell per day (shaped by `options.cells`, default `matrix`, as in the
 * terminal) with a hover `<title>` tooltip, and a legend.
 * Colours come from PALETTES/THEME through CSS variables, and a `prefers-color-scheme`
 * media query switches between the light and dark ramps, so the same file suits light and
 * dark READMEs.
 *
 * @returns the SVG document as a string (no external assets or fonts).
 * Called by: cli (`--svg`).
 * Calls: monthLabels, fmt, esc, levelVars, surfaceVars.
 */
export function renderSvg(
	grid: Grid,
	metric: Metric,
	summary: Summary,
	title: string,
	options: Partial<SvgOptions> = {}
): string {
	const { cells = 'matrix' } = options;
	const shape = GEOMETRY[cells];
	const { dark, light } = PALETTES[metric];
	const width = LEFT + grid.weeks.length * STEP_X + PAD + 10;
	const legendY = TOP + 7 * STEP_Y + 12;
	const height = legendY + shape.height + 21;
	/** Text baseline for a label next to a cell whose top edge is at `top`. Called by: renderSvg. Calls: nothing. */
	const baseline = (top: number) => top + shape.height - 2;
	/** One cell in the current style at its column's `left` and row's `top`. Called by: renderSvg. Calls: nothing. */
	const rect = (level: number, left: number, top: number, inner = '') =>
		`<rect class="l${level}" x="${left + shape.offsetX}" y="${top}" width="${shape.width}" height="${shape.height}"${shape.radius ? ` rx="${shape.radius}"` : ''}>${inner}</rect>`;

	const style = `
    svg{${levelVars(light)}${surfaceVars(THEME.light)}}
    @media (prefers-color-scheme:dark){svg{${levelVars(dark)}${surfaceVars(THEME.dark)}}}
    text{font:500 10px ${shape.font};fill:var(--muted)}
    .t{font-size:16px;font-weight:700;fill:var(--fg)${cells === 'wide' ? ';letter-spacing:-.01em' : ''}}
    .s{font-size:11px}
    .v{font-weight:600;fill:var(--fg)}
    ${[0, 1, 2, 3, 4].map((level) => `.l${level}{fill:var(--l${level})}`).join('')}`;

	const parts: string[] = [];
	parts.push(
		`<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="14" fill="var(--bg)" stroke="var(--border)"/>`
	);
	parts.push(`<text class="t" x="${PAD}" y="${PAD + 16}">${esc(title)}</text>`);
	parts.push(
		`<text class="s" x="${PAD}" y="${PAD + 34}"><tspan class="v">${fmt(summary.total)}</tspan> ${esc(METRIC_LABEL[metric])} · <tspan class="v">${summary.activeDays}</tspan> active days · longest streak <tspan class="v">${summary.longestStreak}d</tspan></text>`
	);

	const labels = [...monthLabels(grid)];
	labels.forEach(([column, name], index) => {
		if ((labels[index + 1]?.[0] ?? Infinity) - column < 3) return;
		parts.push(`<text x="${LEFT + column * STEP_X + shape.offsetX}" y="${TOP - 6}">${name}</text>`);
	});
	['Mon', 'Wed', 'Fri'].forEach((weekday, index) =>
		parts.push(`<text x="${PAD}" y="${baseline(TOP + index * 2 * STEP_Y)}">${weekday}</text>`)
	);

	grid.weeks.forEach((column, week) =>
		column.forEach((cell, weekday) => {
			if (cell.future) return;
			const tooltip = `<title>${cell.key}: ${fmt(cell.value)} ${esc(METRIC_LABEL[metric])}</title>`;
			parts.push(rect(cell.level, LEFT + week * STEP_X, TOP + weekday * STEP_Y, tooltip));
		})
	);

	const legendX = width - PAD - 5 * STEP_X - 26;
	parts.push(`<text x="${legendX - 28}" y="${baseline(legendY)}">Less</text>`);
	[0, 1, 2, 3, 4].forEach((level) => parts.push(rect(level, legendX + level * STEP_X, legendY)));
	parts.push(`<text x="${legendX + 5 * STEP_X + 3}" y="${baseline(legendY)}">More</text>`);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${style}</style>${parts.join('')}</svg>\n`;
}
