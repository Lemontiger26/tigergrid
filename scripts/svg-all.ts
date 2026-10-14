#!/usr/bin/env bun
// Write one SVG per metric into out/. Extra flags go to every run, e.g.
// `bun run svg:all --cells wide -t claude`; -w overrides the default 53 weeks.
// TIGERGRID_SVG_DIR changes the output folder (tests use a temp dir).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { METRICS } from '../src/grid';

const OUT_DIR = process.env.TIGERGRID_SVG_DIR ?? 'out';
const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
// Each run sets its own metric and output file, and --json would replace the SVG.
const RESERVED = ['-m', '--metric', '--svg', '--json'];

const extra = process.argv.slice(2);
const clash = extra.map((arg) => arg.split('=')[0]!).find((flag) => RESERVED.includes(flag));
if (clash) {
	console.error(`svg:all sets ${clash} itself for each metric; drop it from the arguments`);
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const metric of METRICS) {
	const file = join(OUT_DIR, `tigergrid-${metric}.svg`);
	const run = Bun.spawnSync([process.execPath, CLI, '-w', '53', ...extra, '-m', metric, '--svg', file], {
		stdout: 'ignore',
		stderr: 'inherit'
	});
	if (run.exitCode !== 0) process.exit(run.exitCode);
	console.log(`wrote ${file}`);
}
