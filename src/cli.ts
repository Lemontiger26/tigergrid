#!/usr/bin/env bun
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { JsonDay } from '../types/cli';
import type { Day, Days, Tool } from '../types/days';
import type { Grid, Metric, Summary, ToolFilter } from '../types/grid';
import { dayKey } from './days';
import { buildGrid, fmt, gridStart, isMetric, isToolFilter, METRIC_LABEL, summarize } from './grid';
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

const TOOL_LABEL: Record<ToolFilter, string> = { all: 'Claude Code + Codex', claude: 'Claude Code', codex: 'Codex' };

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
 * Called by: main (argument validation).
 * Calls: console.error, process.exit.
 */
function die(message: string): never {
	console.error(`tigergrid: ${message}\n\n${HELP}`);
	process.exit(1);
}

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
	const proc = Bun.spawn(['git', 'config', 'user.email'], { stdout: 'pipe' });
	const email = (await new Response(proc.stdout).text()).trim();
	return email ? [email] : [];
}

/**
 * Flatten one day's Sets and Maps into plain counts and objects for JSON output.
 *
 * @returns the `--json` row for that day.
 * Called by: printJson.
 * Calls: nothing.
 */
const toJsonDay = (date: string, aggregate: Day): JsonDay => ({
	date,
	sessions: { claude: aggregate.sessions.claude.size, codex: aggregate.sessions.codex.size },
	prompts: aggregate.prompts,
	tokens: aggregate.tokens,
	commits: aggregate.commits,
	aiCommits: aggregate.aiCommits,
	projects: Object.fromEntries(aggregate.projects)
});

/**
 * Print every loaded day as JSON, sorted by date. This is the `--json` / `bun run json` output.
 *
 * @returns nothing; writes to stdout.
 * Called by: main.
 * Calls: toJsonDay.
 */
function printJson(days: Days) {
	const rows = [...days.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([date, aggregate]) => toJsonDay(date, aggregate));
	console.log(JSON.stringify(rows, null, 2));
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
function printSummary(days: Days, grid: Grid, summary: Summary, filter: ToolFilter, withGit: boolean) {
	const inView = [...days.entries()].filter(([key]) => key >= grid.start && key <= grid.end).map(([, day]) => day);
	/** Sum a per-day quantity over the visible window. Called by: printSummary. Calls: nothing. */
	const sum = (pick: (day: Day) => number) => inView.reduce((total, day) => total + pick(day), 0);
	/** Count distinct sessions of one tool in the window (a session spanning days counts once). Called by: printSummary. Calls: nothing. */
	const sessions = (tool: Tool) => new Set(inView.flatMap((day) => [...day.sessions[tool]])).size;
	/** Print one aligned `label  value` line. Called by: printSummary. Calls: dim. */
	const row = (label: string, text: string) => console.log(`  ${dim(label.padEnd(16))}${text}`);

	row('active days', `${summary.activeDays} / ${summary.totalDays}`);
	row('streak', `${summary.currentStreak}d current · ${summary.longestStreak}d longest`);
	if (summary.busiest) row('busiest day', `${summary.busiest.key} (${fmt(summary.busiest.value)})`);
	console.log();
	for (const tool of ['claude', 'codex'] as const) {
		if (filter !== 'all' && filter !== tool) continue;
		row(
			TOOL_LABEL[tool],
			`${fmt(sessions(tool))} sessions · ${fmt(sum((day) => day.prompts[tool]))} prompts · ${fmt(sum((day) => day.tokens[tool]))} tokens`
		);
	}
	if (withGit) {
		const commits = sum((day) => day.commits);
		const aiCommits = sum((day) => day.aiCommits);
		const share = commits ? Math.round((aiCommits / commits) * 100) : 0;
		row('git', `${fmt(commits)} commits · ${fmt(aiCommits)} AI-assisted (${share}%)`);
	}

	const projects = new Map<string, number>();
	for (const day of inView) {
		for (const [project, prompts] of day.projects) projects.set(project, (projects.get(project) ?? 0) + prompts);
	}
	const top = [...projects].sort((left, right) => right[1] - left[1]).slice(0, 5);
	if (top.length) {
		row('top projects', top.map(([project, prompts]) => `${project} ${dim(String(prompts))}`).join(dim(' · ')));
	}
}

/**
 * Entry point: validate flags, load all sources in parallel from the start of the grid
 * window, then either dump JSON or print the graph and summary, and write the SVG if asked.
 *
 * @returns resolves when output is written; exits early on `--help`, bad flags, or `--json`.
 * Called by: module top level.
 * Calls: die, isMetric, isToolFilter, gitAuthors, loadClaude, loadCodex, loadGit, printJson,
 *        buildGrid, summarize, renderGrid, printSummary, renderSvg.
 */
async function main() {
	if (args.help) {
		console.log(HELP);
		process.exit(0);
	}
	if (!isMetric(args.metric)) die(`unknown metric "${args.metric}"`);
	if (!isToolFilter(args.tool)) die(`unknown tool "${args.tool}"`);
	const metric: Metric = args.metric;
	const filter: ToolFilter = args.tool;

	const fitWeeks = Math.floor(((process.stdout.columns || 110) - 6) / 2);
	const weeks = args.weeks ? Number(args.weeks) : Math.max(4, Math.min(53, fitWeeks));
	if (!Number.isInteger(weeks) || weeks < 1) die(`--weeks must be a positive integer`);

	const since = dayKey(gridStart(weeks));
	const days: Days = new Map();
	const withGit = !args['no-git'];
	const gitRoots = (args['git-root'] ?? [join(homedir(), 'develop')]).map((root) => resolve(root));

	const started = performance.now();
	const [claudeFiles, codexFiles, repos] = await Promise.all([
		loadClaude(days, since, args['claude-dir'] ? resolve(args['claude-dir']) : undefined),
		loadCodex(days, since, args['codex-dir'] ? resolve(args['codex-dir']) : undefined),
		withGit ? gitAuthors().then((authors) => loadGit(days, since, gitRoots, authors)) : Promise.resolve(0)
	]);
	const elapsed = ((performance.now() - started) / 1000).toFixed(1);

	if (args.json) {
		printJson(days);
		return;
	}

	const grid = buildGrid(days, metric, filter, weeks);
	const summary = summarize(grid);
	const isGitMetric = metric === 'commits' || metric === 'ai';
	const scope = isGitMetric ? 'git' : TOOL_LABEL[filter];

	console.log();
	console.log(
		`  ${bold(`${fmt(summary.total)} ${METRIC_LABEL[metric]}`)} ${dim(`in the last ${weeks} weeks · ${scope}`)}`
	);
	console.log();
	console.log(renderGrid(grid, metric));
	console.log();
	printSummary(days, grid, summary, filter, withGit);
	console.log();
	console.log(dim(`  scanned ${claudeFiles} Claude + ${codexFiles} Codex transcripts, ${repos} repos in ${elapsed}s`));

	if (args.svg) {
		const path = resolve(args.svg);
		const title = isGitMetric ? 'Git activity' : `Agent activity · ${scope}`;
		await Bun.write(path, renderSvg(grid, metric, summary, title));
		console.log(dim(`  wrote ${path}`));
	}
	console.log();
}

await main();
