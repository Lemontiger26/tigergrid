import { fmt, monthLabels, PALETTES, type Grid, type Metric } from '../grid';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const RESET = '\x1b[0m';
const DIM = (s: string) => (color ? `\x1b[2m${s}${RESET}` : s);
const BOLD = (s: string) => (color ? `\x1b[1m${s}${RESET}` : s);

function fg(hex: string, s: string): string {
	if (!color) return s;
	const n = parseInt(hex.slice(1), 16);
	return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}${RESET}`;
}

const MONO = [' ·', ' ░', ' ▒', ' ▓', ' █'];
const cell = (metric: Metric, level: number) => (color ? fg(PALETTES[metric].dark[level]!, ' ■') : MONO[level]!);

const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export function renderGrid(grid: Grid, metric: Metric): string {
	const lines: string[] = [];

	// Month header, two characters per week column.
	const labels = [...monthLabels(grid)];
	let header = '    ';
	labels.forEach(([col, name], i) => {
		const next = labels[i + 1]?.[0] ?? Infinity;
		if (next - col < 2) return; // too narrow to fit the label
		header = header.padEnd(4 + col * 2) + ' ' + name;
	});
	lines.push(DIM(header));

	for (let row = 0; row < 7; row++) {
		let line = DIM(WEEKDAYS[row]!.padEnd(4));
		for (const col of grid.weeks) {
			const c = col[row]!;
			line += c.future ? '  ' : cell(metric, c.level);
		}
		lines.push(line);
	}

	const legend = [0, 1, 2, 3, 4].map((l) => cell(metric, l)).join('');
	lines.push('    ' + ' '.repeat(Math.max(0, grid.weeks.length * 2 - 16)) + DIM('Less') + legend + DIM(' More'));
	return lines.join('\n');
}

export const bold = BOLD;
export const dim = DIM;
export { fmt };
