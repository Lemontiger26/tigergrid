#!/usr/bin/env bun
// Write one SVG per metric into out/. Extra flags go to every run, e.g.
// `bun run svg:all --cells wide -t claude`; -w overrides the default 53 weeks.
import { mkdirSync } from 'node:fs';
import { METRICS } from '../src/grid';

const OUT_DIR = 'out';
// Each run sets its own metric and output file, and --json would replace the SVG.
const RESERVED = ['-m', '--metric', '--svg', '--json'];

const extra = process.argv.slice(2);
const clash = extra.find((arg) => RESERVED.includes(arg.split('=')[0]!));
if (clash) {
	console.error(`svg:all sets ${clash} itself for each metric; drop it from the arguments`);
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const metric of METRICS) {
	const file = `${OUT_DIR}/tigergrid-${metric}.svg`;
	const run = Bun.spawnSync([process.execPath, 'src/cli.ts', '-w', '53', ...extra, '-m', metric, '--svg', file], {
		stdout: 'ignore',
		stderr: 'inherit'
	});
	if (run.exitCode !== 0) process.exit(run.exitCode);
	console.log(`wrote ${file}`);
}
