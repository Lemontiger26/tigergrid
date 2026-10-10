import { fmt, METRIC_LABEL, monthLabels, PALETTES, type Grid, type Metric, type Summary } from '../grid';

const SIZE = 11;
const GAP = 3;
const STEP = SIZE + GAP;
const LEFT = 32;
const TOP = 56;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Self-contained SVG that follows the viewer's light/dark preference. */
export function renderSvg(grid: Grid, metric: Metric, summary: Summary, title: string): string {
	const { dark, light } = PALETTES[metric];
	const width = LEFT + grid.weeks.length * STEP + 24;
	const height = TOP + 7 * STEP + 34;

	const levelVars = (p: string[]) => p.map((c, i) => `--l${i}:${c};`).join('');
	const style = `
    svg{${levelVars(light)}--fg:#1f2328;--muted:#656d76;--bg:#ffffff}
    @media (prefers-color-scheme:dark){svg{${levelVars(dark)}--fg:#e6edf3;--muted:#7d8590;--bg:#0d1117}}
    text{font:10px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;fill:var(--muted)}
    .t{font-size:13px;font-weight:600;fill:var(--fg)}
    ${[0, 1, 2, 3, 4].map((i) => `.l${i}{fill:var(--l${i})}`).join('')}`;

	const parts: string[] = [];
	parts.push(`<rect width="100%" height="100%" rx="6" fill="var(--bg)"/>`);
	parts.push(`<text class="t" x="${LEFT}" y="18">${esc(title)}</text>`);
	parts.push(
		`<text x="${LEFT}" y="32">${fmt(summary.total)} ${esc(METRIC_LABEL[metric])} · ${summary.activeDays} active days · longest streak ${summary.longestStreak}d</text>`
	);

	const labels = [...monthLabels(grid)];
	labels.forEach(([col, name], i) => {
		if ((labels[i + 1]?.[0] ?? Infinity) - col < 3) return;
		parts.push(`<text x="${LEFT + col * STEP}" y="${TOP - 4}">${name}</text>`);
	});
	['Mon', 'Wed', 'Fri'].forEach((d, i) => parts.push(`<text x="2" y="${TOP + i * 2 * STEP + 9}">${d}</text>`));

	grid.weeks.forEach((col, x) =>
		col.forEach((c, y) => {
			if (c.future) return;
			parts.push(
				`<rect class="l${c.level}" x="${LEFT + x * STEP}" y="${TOP + y * STEP}" width="${SIZE}" height="${SIZE}" rx="2"><title>${c.key}: ${fmt(c.value)} ${esc(METRIC_LABEL[metric])}</title></rect>`
			);
		})
	);

	const legendX = width - 12 - 5 * STEP - 30;
	const legendY = TOP + 7 * STEP + 10;
	parts.push(`<text x="${legendX - 28}" y="${legendY + 9}">Less</text>`);
	[0, 1, 2, 3, 4].forEach((l) =>
		parts.push(`<rect class="l${l}" x="${legendX + l * STEP}" y="${legendY}" width="${SIZE}" height="${SIZE}" rx="2"/>`)
	);
	parts.push(`<text x="${legendX + 5 * STEP + 2}" y="${legendY + 9}">More</text>`);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${style}</style>${parts.join('')}</svg>\n`;
}
