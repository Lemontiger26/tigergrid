import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import spec from '../fixtures/git/repos.json';

// Isolate fixture commits from the developer's own git config (signing, hooks, default branch).
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

/**
 * Run git synchronously in `cwd` with an isolated config, throwing on failure.
 *
 * @returns nothing; throws with git's stderr if the command fails.
 * Called by: buildGitFixture.
 * Calls: Bun.spawnSync (git).
 */
function git(cwd: string, args: string[], env: Record<string, string> = {}) {
	const r = Bun.spawnSync(['git', ...args], { cwd, env: { ...ENV, ...env }, stdout: 'ignore', stderr: 'pipe' });
	if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr.toString()}`);
}

/**
 * Build the repos described in test/fixtures/git/repos.json under a fresh temp directory:
 * one empty commit per entry (author and committer date both set to the entry's date),
 * then clones made from already-built repos.
 *
 * @returns the scan root and a cleanup function that deletes it.
 * Called by: test/git.test.ts, test/cli.test.ts.
 * Calls: git, mkdtempSync, mkdirSync, rmSync.
 */
export function buildGitFixture(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), 'tigergrid-git-'));
	for (const [path, commits] of Object.entries(spec.repos)) {
		const repo = join(root, path);
		mkdirSync(repo, { recursive: true });
		git(repo, ['init', '-q', '-b', 'main']);
		for (const c of commits) {
			git(repo, ['commit', '-q', '--allow-empty', '-m', c.message], {
				GIT_AUTHOR_NAME: c.author.split('@')[0]!,
				GIT_AUTHOR_EMAIL: c.author,
				GIT_COMMITTER_NAME: c.author.split('@')[0]!,
				GIT_COMMITTER_EMAIL: c.author,
				GIT_AUTHOR_DATE: c.date,
				GIT_COMMITTER_DATE: c.date
			});
		}
	}
	for (const [path, source] of Object.entries(spec.clones)) {
		mkdirSync(join(root, path, '..'), { recursive: true });
		git(root, ['clone', '-q', join(root, source), join(root, path)]);
	}
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
