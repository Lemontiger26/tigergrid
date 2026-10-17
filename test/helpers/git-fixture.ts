import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import spec from '../fixtures/git/repos.json';

// Isolate fixture commits from the developer's own git config (signing, hooks, default branch)
// and from GIT_* variables inherited from a hook: `git commit -a` points GIT_INDEX_FILE at the
// outer repo's temporary index, which would otherwise end up in every fixture commit.
const ENV = {
	...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1'
};

/**
 * Run git synchronously in `cwd` with an isolated config, throwing on failure.
 *
 * @returns nothing; throws with git's stderr if the command fails.
 * Called by: buildGitFixture.
 * Calls: Bun.spawnSync (git).
 */
function git(cwd: string, args: string[], env: Record<string, string> = {}) {
	const result = Bun.spawnSync(['git', ...args], { cwd, env: { ...ENV, ...env }, stdout: 'ignore', stderr: 'pipe' });
	if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.toString()}`);
}

/**
 * Git environment that makes a fixture entry's author the commit's author and committer,
 * at the entry's date.
 *
 * @returns GIT_AUTHOR_* / GIT_COMMITTER_* variables for `git`.
 * Called by: buildGitFixture.
 * Calls: nothing.
 */
function identity(entry: { date: string; author: string }): Record<string, string> {
	const name = entry.author.split('@')[0] ?? entry.author;
	return {
		GIT_AUTHOR_NAME: name,
		GIT_AUTHOR_EMAIL: entry.author,
		GIT_COMMITTER_NAME: name,
		GIT_COMMITTER_EMAIL: entry.author,
		GIT_AUTHOR_DATE: entry.date,
		GIT_COMMITTER_DATE: entry.date
	};
}

/**
 * Build the repos described in test/fixtures/git/repos.json under a fresh temp directory:
 * one empty commit per entry (author and committer date both set to the entry's date),
 * then stashes (an untracked file stashed with the entry's identity and date), then clones
 * made from already-built repos.
 *
 * @returns the scan root and a cleanup function that deletes it.
 * Called by: test/git.test.ts, test/cli.test.ts.
 * Calls: git, identity, mkdtempSync, mkdirSync, writeFileSync, rmSync.
 */
export function buildGitFixture(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), 'tigergrid-git-'));
	for (const [path, commits] of Object.entries(spec.repos)) {
		const repo = join(root, path);
		mkdirSync(repo, { recursive: true });
		git(repo, ['init', '-q', '-b', 'main']);
		for (const commit of commits) {
			git(repo, ['commit', '-q', '--allow-empty', '-m', commit.message], identity(commit));
		}
	}
	for (const [path, stash] of Object.entries(spec.stashes)) {
		const repo = join(root, path);
		writeFileSync(join(repo, 'wip.txt'), 'work in progress\n');
		git(repo, ['stash', 'push', '-q', '--include-untracked', '-m', stash.message], identity(stash));
	}
	for (const [path, source] of Object.entries(spec.clones)) {
		mkdirSync(join(root, path, '..'), { recursive: true });
		git(root, ['clone', '-q', join(root, source), join(root, path)]);
	}
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
