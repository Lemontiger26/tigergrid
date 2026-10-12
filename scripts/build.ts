#!/usr/bin/env bun
// Compile tigergrid into standalone executables (no Bun needed to run them) and write
// SHA256SUMS next to them. Usage: `bun run build` for every target, or
// `bun scripts/build.ts bun-linux-x64` for a subset (CI builds one per runner).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS = ['bun-linux-x64', 'bun-linux-arm64', 'bun-darwin-arm64'];
const OUT_DIR = 'dist';

/**
 * Run a command and fail loudly with its stderr if it exits non-zero.
 *
 * @returns the command's trimmed stdout.
 * Called by: buildCommit, compile.
 * Calls: Bun.spawnSync.
 */
function run(cmd: string[]): string {
	const result = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
	if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed:\n${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

/**
 * Identify the source a binary is built from: the short commit hash, marked `-dirty` when the
 * working tree has uncommitted changes, so a binary never claims to be a commit it isn't.
 *
 * @returns e.g. `3d9b5ea` or `3d9b5ea-dirty`.
 * Called by: module top level.
 * Calls: run.
 */
function buildCommit(): string {
	const commit = run(['git', 'rev-parse', '--short', 'HEAD']);
	return run(['git', 'status', '--porcelain']) ? `${commit}-dirty` : commit;
}

/**
 * Compile the CLI for one target. The commit is baked in through `process.env.TIGERGRID_COMMIT`
 * (read by `--version`), and the binary ignores `.env` and `bunfig.toml` files in whatever
 * directory it runs from.
 *
 * @returns the output path, e.g. `dist/tigergrid-linux-x64`.
 * Called by: module top level.
 * Calls: run.
 */
function compile(target: string, commit: string): string {
	const outfile = join(OUT_DIR, `tigergrid-${target.replace(/^bun-/, '')}`);
	run([
		'bun',
		'build',
		'src/cli.ts',
		'--compile',
		`--target=${target}`,
		'--no-compile-autoload-dotenv',
		'--no-compile-autoload-bunfig',
		`--define=process.env.TIGERGRID_COMMIT=${JSON.stringify(commit)}`,
		`--outfile=${outfile}`
	]);
	return outfile;
}

/**
 * Hash a file the way `sha256sum` does.
 *
 * @returns the lowercase hex SHA-256 of the file's bytes.
 * Called by: module top level.
 * Calls: Bun.file().arrayBuffer, Bun.CryptoHasher.
 */
async function sha256(path: string): Promise<string> {
	const hasher = new Bun.CryptoHasher('sha256');
	hasher.update(await Bun.file(path).arrayBuffer());
	return hasher.digest('hex');
}

const requested = process.argv.slice(2);
const unknown = requested.filter((target) => !TARGETS.includes(target));
if (unknown.length) throw new Error(`unknown target(s): ${unknown.join(', ')}; supported: ${TARGETS.join(', ')}`);
const targets = requested.length ? requested : TARGETS;

mkdirSync(OUT_DIR, { recursive: true });
const commit = buildCommit();
const lines: string[] = [];
for (const target of targets) {
	const outfile = compile(target, commit);
	const name = outfile.slice(OUT_DIR.length + 1);
	lines.push(`${await sha256(outfile)}  ${name}`);
	console.log(`built ${outfile} (${commit})`);
}
await Bun.write(join(OUT_DIR, 'SHA256SUMS'), lines.join('\n') + '\n');
console.log(`wrote ${join(OUT_DIR, 'SHA256SUMS')}`);
