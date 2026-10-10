import { existsSync, type Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { day, keyOfTimestamp, type Days } from '../days';

// Trailers and footers that agents add to the commits they author.
const AI_MARKERS =
	/co-authored-by:[^\n]*(claude|anthropic|codex|openai|copilot|cursor|gemini|aider|devin)|generated with \[?(claude code|codex|cursor)/i;

const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', '.venv', 'Pods', 'DerivedData', 'target']);

/** Walk down to maxDepth looking for .git entries, without descending into a repo once found. */
async function findRepos(dir: string, maxDepth: number): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	if (entries.some((e) => e.name === '.git')) return [dir];
	if (maxDepth === 0) return [];
	const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name));
	return (await Promise.all(subdirs.map((e) => findRepos(join(dir, e.name), maxDepth - 1)))).flat();
}

async function git(repo: string, args: string[]): Promise<string> {
	const p = Bun.spawn(['git', '-C', repo, ...args], { stdout: 'pipe', stderr: 'ignore' });
	const out = await new Response(p.stdout).text();
	await p.exited;
	return out;
}

export async function loadGit(days: Days, since: string, roots: string[], authors: string[]): Promise<number> {
	const seen = new Set<string>();
	const repos = (await Promise.all(roots.filter(existsSync).map((r) => findRepos(r, 4)))).flat();

	await Promise.all(
		repos.map(async (repo) => {
			const authorArgs = authors.map((a) => `--author=${a}`);
			const out = await git(repo, ['log', '--all', `--since=${since}`, ...authorArgs, '--format=%H%x1f%aI%x1f%B%x1e']);
			for (const entry of out.split('\x1e')) {
				const [hash, date, body] = entry.trim().split('\x1f');
				if (!hash || seen.has(hash)) continue; // worktrees and clones share commits
				seen.add(hash);
				const key = keyOfTimestamp(date);
				if (!key || key < since) continue;
				const d = day(days, key);
				d.commits++;
				if (AI_MARKERS.test(body ?? '')) d.aiCommits++;
			}
		})
	);
	return repos.length;
}
