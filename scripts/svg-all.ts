#!/usr/bin/env bun
// Write one SVG per metric into out/. Extra flags go to every run, e.g.
// `bun run svg:all --cells wide -t claude`; -w overrides the default 53 weeks.
// `-m prompts,sessions,ai` limits the run to those metrics and, for more than one, also writes
// their combined graph (tigergrid-prompts-sessions-ai.svg).
// TIGERGRID_SVG_DIR changes the output folder (tests use a temp dir).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Metric } from '../types/grid';
import { isMetric, METRICS } from '../src/grid';

const OUT_DIR = process.env.TIGERGRID_SVG_DIR ?? 'out';
const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
// Each run sets its own output file, and --json would replace the SVG.
const RESERVED = ['--svg', '--json'];

/**
 * Print an error and exit before anything is written.
 *
 * @returns never.
 * Called by: takeMetrics, module top level.
 * Calls: console.error, process.exit.
 */
function fail(message: string): never {
	console.error(`svg:all: ${message}`);
	process.exit(1);
}

/**
 * Take the metric list out of the arguments, in any form the CLI accepts (`-m a,b`,
 * `-ma,b`, `--metric a,b`, `--metric=a,b`); as in the CLI, the last one wins.
 *
 * @returns the listed metrics (deduplicated, in order; null without -m) and the other arguments.
 * Called by: module top level.
 * Calls: fail, isMetric.
 */
function takeMetrics(args: string[]): { metrics: Metric[] | null; rest: string[] } {
	let list: string | null = null;
	const rest: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (arg === '-m' || arg === '--metric') {
			list = args[++index] ?? fail(`${arg} needs a value`);
		} else if (arg.startsWith('--metric=')) list = arg.slice('--metric='.length);
		else if (arg.startsWith('-m') && arg.length > 2) list = arg.slice(2);
		else rest.push(arg);
	}
	if (list === null) return { metrics: null, rest };
	const metrics: Metric[] = [];
	for (const name of list.split(',').map((part) => part.trim())) {
		if (!isMetric(name)) fail(`unknown metric "${name}"`);
		if (!metrics.includes(name)) metrics.push(name);
	}
	if (!metrics.length) fail('-m needs at least one metric');
	return { metrics, rest };
}

const { metrics, rest: extra } = takeMetrics(process.argv.slice(2));
const clash = extra.map((arg) => arg.split('=')[0]!).find((flag) => RESERVED.includes(flag));
if (clash) fail(`${clash} is set per run; drop it from the arguments`);

// One run per metric, then the combined graph when several were asked for.
const runs = (metrics ?? METRICS).map((metric) => [metric]);
if (metrics && metrics.length > 1) runs.push(metrics);

mkdirSync(OUT_DIR, { recursive: true });
for (const run of runs) {
	const file = join(OUT_DIR, `tigergrid-${run.join('-')}.svg`);
	const spawned = Bun.spawnSync([process.execPath, CLI, '-w', '53', ...extra, '-m', run.join(','), '--svg', file], {
		stdout: 'ignore',
		stderr: 'inherit'
	});
	if (spawned.exitCode !== 0) process.exit(spawned.exitCode);
	console.log(`wrote ${file}`);
}
