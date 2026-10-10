#!/usr/bin/env bun
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dayKey, type Day, type Days } from './days';
import {
	buildGrid,
	fmt,
	gridStart,
	METRIC_LABEL,
	METRICS,
	summarize,
	type Grid,
	type Metric,
	type Summary,
	type ToolFilter
} from './grid';
import { renderSvg } from './render/svg';
import { bold, dim, renderGrid } from './render/terminal';
import { loadClaude } from './sources/claude';
import { loadCodex } from './sources/codex';
import { loadGit } from './sources/git';

const HELP = `TigerGrid — a contribution graph of your AI coding agents

Usage: tigergrid [options]

  -m, --metric <name>   prompts | sessions | tokens | commits | ai   (default: prompts)
  -t, --tool <name>     claude | codex | all                          (default: all)
  -w, --weeks <n>       weeks to show (default: fit terminal, max 53)
  -r, --git-root <dir>  where to look for git repos, repeatable      (default: ~/develop)
  -a, --author <pat>    git author filter, repeatable                (default: git config user.email)
      --claude-dir <d>  Claude Code projects dir                     (default: ~/.claude/projects)
      --codex-dir <d>   Codex home dir                               (default: ~/.codex)
      --no-git          skip the git scan
      --svg <file>      also write an embeddable SVG
      --json            print per-day data as JSON instead of the graph
  -h, --help

Sources: Claude Code transcripts, Codex rollouts, and git repos under --git-root.
"tokens" counts fresh tokens (uncached input + cache writes + output); cache reads are excluded.
"ai" counts commits carrying an agent Co-Authored-By trailer or a "Generated with" footer.`;

const { values: args } = parseArgs({
	options: {
		metric: { type: 'string', short: 'm', default: 'prompts' },
		tool: { type: 'string', short: 't', default: 'all' },
		weeks: { type: 'string', short: 'w' },
		'git-root': { type: 'string', short: 'r', multiple: true },
		author: { type: 'string', short: 'a', multiple: true },
		'claude-dir': { type: 'string' },
		'codex-dir': { type: 'string' },
		'no-git': { type: 'boolean', default: false },
		svg: { type: 'string' },
		json: { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false }
	}
});

/**
 * Abort on invalid input: print the message and the usage text to stderr, exit with code 1.
 *
 * @returns never.
 * Called by: argument validation below.
 * Calls: console.error, process.exit.
 */
const die = (msg: string): never => {
	console.error(`tigergrid: ${msg}\n\n${HELP}`);
	process.exit(1);
};

/**
 * Pick the git author filters: the `--author` flags if given, else the global
 * `git config user.email`, else no filter (all authors).
 *
 * @returns author patterns for `git log --author`.
 * Called by: main.
 * Calls: Bun.spawn (git config).
 */
async function gitAuthors(): Promise<string[]> {
	if (args.author?.length) return args.author;
	const p = Bun.spawn(['git', 'config', 'user.email'], { stdout: 'pipe' });
	const email = (await new Response(p.stdout).text()).trim();
	return email ? [email] : [];
}

/**
 * Print every loaded day as JSON, sorted by date, with Sets and Maps flattened to plain
 * counts and objects. This is the `--json` / `bun run json` output.
 *
 * @returns nothing; writes to stdout.
 * Called by: main.
 * Calls: nothing.
 */
function printJson(days: Days) {
	const out = [...days.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, d]) => ({
			date,
			sessions: { claude: d.sessions.claude.size, codex: d.sessions.codex.size },
			prompts: d.prompts,
			tokens: d.tokens,
			commits: d.commits,
			aiCommits: d.aiCommits,
			projects: Object.fromEntries(d.projects)
		}));
	console.log(JSON.stringify(out, null, 2));
}

/**
 * Print the stats block under the graph: streaks and busiest day for the chosen metric,
 * then window totals for every source regardless of metric (sessions/prompts/tokens per tool,
 * commits and the AI-assisted share) and the top five projects by prompts.
 *
 * @returns nothing; writes to stdout.
 * Called by: main.
 * Calls: fmt, dim; the local helpers row, sum and sessions.
 */
function printSummary(days: Days, grid: Grid, s: Summary, tool: ToolFilter, withGit: boolean) {
	const inView = [...days.entries()].filter(([k]) => k >= grid.start && k <= grid.end).map(([, d]) => d);
	/** Sum a per-day quantity over the visible window. Called by: printSummary. Calls: nothing. */
	const sum = (f: (d: Day) => number) => inView.reduce((n, d) => n + f(d), 0);
	/** Count distinct sessions of one tool in the window (a session spanning days counts once). Called by: printSummary. Calls: nothing. */
	const sessions = (t: 'claude' | 'codex') => new Set(inView.flatMap((d) => [...d.sessions[t]])).size;
	/** Print one aligned `label  value` line. Called by: printSummary. Calls: dim. */
	const row = (label: string, value: string) => console.log(`  ${dim(label.padEnd(16))}${value}`);

	row('active days', `${s.activeDays} / ${s.totalDays}`);
	row('streak', `${s.currentStreak}d current · ${s.longestStreak}d longest`);
	if (s.busiest) row('busiest day', `${s.busiest.key} (${fmt(s.busiest.value)})`);
	console.log();
	for (const t of ['claude', 'codex'] as const) {
		if (tool !== 'all' && tool !== t) continue;
		row(
			t === 'claude' ? 'Claude Code' : 'Codex',
			`${fmt(sessions(t))} sessions · ${fmt(sum((d) => d.prompts[t]))} prompts · ${fmt(sum((d) => d.tokens[t]))} tokens`
		);
	}
	if (withGit) {
		const commits = sum((d) => d.commits);
		const ai = sum((d) => d.aiCommits);
		row('git', `${fmt(commits)} commits · ${fmt(ai)} AI-assisted (${commits ? Math.round((ai / commits) * 100) : 0}%)`);
	}

	const projects = new Map<string, number>();
	for (const d of inView) for (const [p, n] of d.projects) projects.set(p, (projects.get(p) ?? 0) + n);
	const top = [...projects].sort((a, b) => b[1] - a[1]).slice(0, 5);
	if (top.length) row('top projects', top.map(([p, n]) => `${p} ${dim(String(n))}`).join(dim(' · ')));
}

/**
 * Entry point: validate flags, load all sources in parallel from the start of the grid
 * window, then either dump JSON or print the graph and summary, and write the SVG if asked.
 *
 * @returns resolves when output is written; exits early on `--help`, bad flags, or `--json`.
 * Called by: module top level.
 * Calls: die, gitAuthors, loadClaude, loadCodex, loadGit, printJson, buildGrid, summarize,
 *        renderGrid, printSummary, renderSvg.
 */
async function main() {
	if (args.help) {
		console.log(HELP);
		process.exit(0);
	}
	const metric = args.metric as Metric;
	if (!METRICS.includes(metric)) die(`unknown metric "${args.metric}"`);
	const tool = args.tool as ToolFilter;
	if (!['claude', 'codex', 'all'].includes(tool)) die(`unknown tool "${args.tool}"`);

	const fitWeeks = Math.floor(((process.stdout.columns || 110) - 6) / 2);
	const weeks = args.weeks ? Number(args.weeks) : Math.max(4, Math.min(53, fitWeeks));
	if (!Number.isInteger(weeks) || weeks < 1) die(`--weeks must be a positive integer`);

	const since = dayKey(gridStart(weeks));
	const days: Days = new Map();
	const withGit = !args['no-git'];

	const started = performance.now();
	const [claudeFiles, codexFiles, repos] = await Promise.all([
		loadClaude(days, since, args['claude-dir'] ? resolve(args['claude-dir']) : undefined),
		loadCodex(days, since, args['codex-dir'] ? resolve(args['codex-dir']) : undefined),
		withGit
			? gitAuthors().then((authors) =>
					loadGit(
						days,
						since,
						(args['git-root'] ?? [join(homedir(), 'develop')]).map((r) => resolve(r)),
						authors
					)
				)
			: Promise.resolve(0)
	]);
	const elapsed = ((performance.now() - started) / 1000).toFixed(1);

	if (args.json) {
		printJson(days);
		return;
	}

	const grid = buildGrid(days, metric, tool, weeks);
	const s = summarize(grid);
	const toolLabel = tool === 'all' ? 'Claude Code + Codex' : tool === 'claude' ? 'Claude Code' : 'Codex';
	const scope = metric === 'commits' || metric === 'ai' ? 'git' : toolLabel;

	console.log();
	console.log(`  ${bold(`${fmt(s.total)} ${METRIC_LABEL[metric]}`)} ${dim(`in the last ${weeks} weeks · ${scope}`)}`);
	console.log();
	console.log(renderGrid(grid, metric));
	console.log();
	printSummary(days, grid, s, tool, withGit);
	console.log();
	console.log(dim(`  scanned ${claudeFiles} Claude + ${codexFiles} Codex transcripts, ${repos} repos in ${elapsed}s`));

	if (args.svg) {
		const path = resolve(args.svg);
		await Bun.write(path, renderSvg(grid, metric, s, scope === 'git' ? 'Git activity' : `Agent activity · ${scope}`));
		console.log(dim(`  wrote ${path}`));
	}
	console.log();
}

await main();
