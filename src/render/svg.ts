import type { Grid, Metric, Summary, Theme } from '../../types/grid';
import { fmt, METRIC_LABEL, monthLabels, PALETTES, THEME } from '../grid';

const SIZE = 11;
const GAP = 3;
const STEP = SIZE + GAP;
const PAD = 20;
const LEFT = PAD + 30;
const TOP = 80;

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
 * weekday labels, one rounded cell per day with a hover `<title>` tooltip, and a legend.
 * Colours come from PALETTES/THEME through CSS variables, and a `prefers-color-scheme`
 * media query switches between the light and dark ramps, so the same file suits light and
 * dark READMEs.
 *
 * @returns the SVG document as a string (no external assets or fonts).
 * Called by: cli (`--svg`).
 * Calls: monthLabels, fmt, esc, levelVars, surfaceVars.
 */
export function renderSvg(grid: Grid, metric: Metric, summary: Summary, title: string): string {
	const { dark, light } = PALETTES[metric];
	const width = LEFT + grid.weeks.length * STEP + PAD + 10;
	const height = TOP + 7 * STEP + 44;

	const style = `
    svg{${levelVars(light)}${surfaceVars(THEME.light)}}
    @media (prefers-color-scheme:dark){svg{${levelVars(dark)}${surfaceVars(THEME.dark)}}}
    text{font:500 10px Inter,'General Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;fill:var(--muted)}
    .t{font-size:16px;font-weight:700;fill:var(--fg);letter-spacing:-.01em}
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
		parts.push(`<text x="${LEFT + column * STEP}" y="${TOP - 6}">${name}</text>`);
	});
	['Mon', 'Wed', 'Fri'].forEach((weekday, index) =>
		parts.push(`<text x="${PAD}" y="${TOP + index * 2 * STEP + 9}">${weekday}</text>`)
	);

	grid.weeks.forEach((column, week) =>
		column.forEach((cell, weekday) => {
			if (cell.future) return;
			parts.push(
				`<rect class="l${cell.level}" x="${LEFT + week * STEP}" y="${TOP + weekday * STEP}" width="${SIZE}" height="${SIZE}" rx="3"><title>${cell.key}: ${fmt(cell.value)} ${esc(METRIC_LABEL[metric])}</title></rect>`
			);
		})
	);

	const legendX = width - PAD - 5 * STEP - 26;
	const legendY = TOP + 7 * STEP + 12;
	parts.push(`<text x="${legendX - 28}" y="${legendY + 9}">Less</text>`);
	[0, 1, 2, 3, 4].forEach((level) =>
		parts.push(
			`<rect class="l${level}" x="${legendX + level * STEP}" y="${legendY}" width="${SIZE}" height="${SIZE}" rx="3"/>`
		)
	);
	parts.push(`<text x="${legendX + 5 * STEP + 3}" y="${legendY + 9}">More</text>`);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${style}</style>${parts.join('')}</svg>\n`;
}
