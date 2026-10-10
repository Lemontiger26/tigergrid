#!/usr/bin/env bun
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dayKey, type Days } from './days';
import { buildGrid, fmt, gridStart, METRIC_LABEL, METRICS, summarize, type Metric, type ToolFilter } from './grid';
import { bold, dim, renderGrid } from './render/terminal';
import { renderSvg } from './render/svg';
import { loadClaude } from './sources/claude';
import { loadCodex } from './sources/codex';
import { loadGit } from './sources/git';

const HELP = `agentgrid — a contribution graph of your AI coding agents

Usage: agentgrid [options]

  -m, --metric <name>   prompts | sessions | tokens | commits | ai   (default: prompts)
  -t, --tool <name>     claude | codex | all                          (default: all)
  -w, --weeks <n>       weeks to show (default: fit terminal, max 53)
  -r, --git-root <dir>  where to look for git repos, repeatable      (default: ~/develop)
  -a, --author <pat>    git author filter, repeatable                (default: git config user.email)
      --no-git          skip the git scan
      --svg <file>      also write an embeddable SVG
      --json            print per-day data as JSON instead of the graph
  -h, --help

Sources: ~/.claude/projects, ~/.codex/sessions, and git repos under --git-root.
"tokens" counts fresh tokens (uncached input + cache writes + output); cache reads are excluded.
"ai" counts commits carrying an agent Co-Authored-By trailer or a "Generated with" footer.`;

const { values: args } = parseArgs({
	options: {
		metric: { type: 'string', short: 'm', default: 'prompts' },
		tool: { type: 'string', short: 't', default: 'all' },
		weeks: { type: 'string', short: 'w' },
		'git-root': { type: 'string', short: 'r', multiple: true },
		author: { type: 'string', short: 'a', multiple: true },
		'no-git': { type: 'boolean', default: false },
		svg: { type: 'string' },
		json: { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false }
	}
});

if (args.help) {
	console.log(HELP);
	process.exit(0);
}

const die = (msg: string): never => {
	console.error(`agentgrid: ${msg}\n\n${HELP}`);
	process.exit(1);
};

const metric = args.metric as Metric;
if (!METRICS.includes(metric)) die(`unknown metric "${args.metric}"`);
const tool = args.tool as ToolFilter;
if (!['claude', 'codex', 'all'].includes(tool)) die(`unknown tool "${args.tool}"`);

const fitWeeks = Math.floor(((process.stdout.columns || 110) - 6) / 2);
const weeks = args.weeks ? Number(args.weeks) : Math.max(4, Math.min(53, fitWeeks));
if (!Number.isInteger(weeks) || weeks < 1) die(`--weeks must be a positive integer`);

const since = dayKey(gridStart(weeks));
const days: Days = new Map();

async function gitAuthors(): Promise<string[]> {
	if (args.author?.length) return args.author;
	const p = Bun.spawn(['git', 'config', 'user.email'], { stdout: 'pipe' });
	const email = (await new Response(p.stdout).text()).trim();
	return email ? [email] : [];
}

const started = performance.now();
const [claudeFiles, codexFiles, repos] = await Promise.all([
	loadClaude(days, since),
	loadCodex(days, since),
	args['no-git']
		? Promise.resolve(0)
		: gitAuthors().then((authors) =>
				loadGit(
					days,
					since,
					(args['git-root'] ?? [join(homedir(), 'develop')]).map((r) => resolve(r)),
					authors
				)
			)
]);
const elapsed = ((performance.now() - started) / 1000).toFixed(1);

if (args.json) {
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
	process.exit(0);
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

// Totals across the visible window, independent of the chosen metric.
const inView = [...days.entries()].filter(([k]) => k >= grid.start && k <= grid.end).map(([, d]) => d);
const sum = (f: (d: (typeof inView)[number]) => number) => inView.reduce((n, d) => n + f(d), 0);
const sessions = (t: 'claude' | 'codex') => new Set(inView.flatMap((d) => [...d.sessions[t]])).size;

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
if (!args['no-git']) {
	const commits = sum((d) => d.commits);
	const ai = sum((d) => d.aiCommits);
	row('git', `${fmt(commits)} commits · ${fmt(ai)} AI-assisted (${commits ? Math.round((ai / commits) * 100) : 0}%)`);
}

const projects = new Map<string, number>();
for (const d of inView) for (const [p, n] of d.projects) projects.set(p, (projects.get(p) ?? 0) + n);
const top = [...projects].sort((a, b) => b[1] - a[1]).slice(0, 5);
if (top.length) row('top projects', top.map(([p, n]) => `${p} ${dim(String(n))}`).join(dim(' · ')));

console.log();
console.log(dim(`  scanned ${claudeFiles} Claude + ${codexFiles} Codex transcripts, ${repos} repos in ${elapsed}s`));

if (args.svg) {
	const path = resolve(args.svg);
	await Bun.write(path, renderSvg(grid, metric, s, `Agent activity · ${toolLabel}`));
	console.log(dim(`  wrote ${path}`));
}
console.log();
