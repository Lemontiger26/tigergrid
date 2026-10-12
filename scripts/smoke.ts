#!/usr/bin/env bun
// Build every binary and smoke-test each one against the fixtures on this machine: natively
// when the binary matches the host, in a Docker container of the right CPU architecture for
// other Linux targets (QEMU or Rosetta emulation), skipped when neither is possible (macOS
// binaries only run on a Mac). Usage: `bun run smoke`.
import pkg from '../package.json';

interface Target {
	/** Bun compile target, as passed to scripts/build.ts. */
	name: string;
	os: 'linux' | 'darwin';
	arch: 'x64' | 'arm64';
}

interface Outcome {
	target: string;
	how: string;
	ok: boolean;
	detail: string;
}

const TARGETS: Target[] = [
	{ name: 'bun-linux-x64', os: 'linux', arch: 'x64' },
	{ name: 'bun-linux-arm64', os: 'linux', arch: 'arm64' },
	{ name: 'bun-darwin-arm64', os: 'darwin', arch: 'arm64' }
];
const LINUX_IMAGE = 'debian:bookworm-slim';
const DOCKER_PLATFORM = { x64: 'linux/amd64', arm64: 'linux/arm64' } as const;
const FIXTURES = ['--no-git', '--claude-dir', 'test/fixtures/claude', '--codex-dir', 'test/fixtures/codex'];
// From test/fixtures/README.md: with a window wide enough to include the 2026-08-01 records.
const EXPECTED = { days: 6, prompts: 8 };

/**
 * Run a command, capturing its output.
 *
 * @returns exit code, stdout and stderr.
 * Called by: dockerAvailable, runner, checkTarget, module top level.
 * Calls: Bun.spawnSync.
 */
function exec(cmd: string[]): { code: number; stdout: string; stderr: string } {
	const result = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1' } });
	return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/**
 * Check that a Docker daemon is reachable.
 *
 * @returns true if `docker info` succeeds.
 * Called by: module top level.
 * Calls: exec.
 */
const dockerAvailable = (): boolean => exec(['docker', 'info', '--format', '{{.ServerVersion}}']).code === 0;

/**
 * Decide how to run a target's binary on this machine: directly when OS and CPU match the
 * host; in a Linux container of the target's architecture when Docker is available; otherwise
 * not at all.
 *
 * @returns a description and a function that prefixes a binary invocation, or null to skip.
 * Called by: module top level.
 * Calls: nothing.
 */
function runner(target: Target, docker: boolean): { how: string; wrap: (args: string[]) => string[] } | null {
	if (target.os === process.platform && target.arch === process.arch) return { how: 'native', wrap: (args) => args };
	if (target.os !== 'linux' || !docker) return null;
	const platform = DOCKER_PLATFORM[target.arch];
	return {
		how: `docker ${platform}`,
		wrap: (args) => [
			'docker',
			'run',
			'--rm',
			`--platform=${platform}`,
			'-v',
			`${process.cwd()}:/work:ro`,
			'-w',
			'/work',
			'-e',
			'NO_COLOR=1',
			LINUX_IMAGE,
			...args
		]
	};
}

/**
 * Run the three checks against one binary: `--version` names this package version and a
 * commit; `--json` over the fixtures gives the expected days and prompts; the terminal
 * output renders and names the fixture transcripts it scanned.
 *
 * @returns the first failing check's message, or a short success note.
 * Called by: module top level.
 * Calls: exec.
 */
function checkTarget(binary: string, wrap: (args: string[]) => string[]): { ok: boolean; detail: string } {
	const version = exec(wrap([binary, '--version']));
	const versionPattern = new RegExp(`^tigergrid ${pkg.version.replaceAll('.', '\\.')} \\([0-9a-f]+(-dirty)?\\)$`);
	if (version.code !== 0 || !versionPattern.test(version.stdout.trim())) {
		return { ok: false, detail: `--version: ${(version.stdout + version.stderr).trim() || `exit ${version.code}`}` };
	}

	const json = exec(wrap([binary, '--json', '-w', '520', ...FIXTURES]));
	if (json.code !== 0) return { ok: false, detail: `--json exited ${json.code}: ${json.stderr.trim()}` };
	// Our own --json output; only the fields counted here are read.
	const rows = JSON.parse(json.stdout) as { prompts: { claude: number; codex: number } }[];
	const prompts = rows.reduce((sum, row) => sum + row.prompts.claude + row.prompts.codex, 0);
	if (rows.length !== EXPECTED.days || prompts !== EXPECTED.prompts) {
		return {
			ok: false,
			detail: `--json: ${rows.length} days / ${prompts} prompts, expected ${EXPECTED.days} / ${EXPECTED.prompts}`
		};
	}

	const terminal = exec(wrap([binary, '-w', '8', ...FIXTURES]));
	if (terminal.code !== 0 || !terminal.stdout.includes('scanned 3 Claude + 4 Codex transcripts')) {
		return { ok: false, detail: `terminal output: exit ${terminal.code} ${terminal.stderr.trim()}` };
	}
	return { ok: true, detail: `${version.stdout.trim()}; ${rows.length} days, ${prompts} prompts` };
}

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !TARGETS.some((target) => target.name === name));
if (unknown.length) {
	console.error(`unknown target(s): ${unknown.join(', ')}`);
	process.exit(1);
}
const targets = requested.length ? TARGETS.filter((target) => requested.includes(target.name)) : TARGETS;

const build = exec(['bun', 'scripts/build.ts', ...targets.map((target) => target.name)]);
if (build.code !== 0) {
	console.error(build.stderr);
	process.exit(1);
}
process.stdout.write(build.stdout);

const docker = dockerAvailable();
if (!docker) console.log("docker not available: Linux binaries that don't match this machine are skipped");

const outcomes: Outcome[] = [];
for (const target of targets) {
	const binary = `dist/tigergrid-${target.name.replace(/^bun-/, '')}`;
	const how = runner(target, docker);
	if (!how) {
		outcomes.push({ target: target.name, how: 'skipped', ok: true, detail: `can't run ${target.os} binaries here` });
		continue;
	}
	outcomes.push({ target: target.name, how: how.how, ...checkTarget(binary, how.wrap) });
}

/**
 * The status mark for one result line.
 *
 * @returns – for skipped, ✓ for passed, ✗ for failed.
 * Called by: module top level.
 * Calls: nothing.
 */
function markOf(outcome: Outcome): string {
	if (outcome.how === 'skipped') return '–';
	return outcome.ok ? '✓' : '✗';
}

console.log();
for (const outcome of outcomes) {
	console.log(`${markOf(outcome)} ${outcome.target.padEnd(18)} ${outcome.how.padEnd(20)} ${outcome.detail}`);
}
process.exit(outcomes.every((outcome) => outcome.ok) ? 0 : 1);
