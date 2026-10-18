#!/usr/bin/env bun
// Build binaries and smoke-test each one against the fixtures on this machine: natively when
// the binary matches the host, in a Docker container of the right CPU architecture for other
// Linux targets (QEMU or Rosetta emulation), skipped when neither is possible (macOS binaries
// only run on a Mac). Usage: `bun run smoke` for every target, or `bun scripts/smoke.ts
// bun-linux-x64` for a subset (CI smoke-tests one target per runner this way).
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pkg from '../package.json';

interface Target {
	/** Bun compile target, as passed to scripts/build.ts. */
	name: string;
	os: 'linux' | 'darwin';
	arch: 'x64' | 'arm64';
}

interface Runner {
	how: string;
	/** Prefix a binary invocation so it runs natively or in a container. */
	wrap: (args: string[]) => string[];
	/** Where the binary should write a file so it lands in OUT_DIR on the host. */
	outPath: (name: string) => string;
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
// Inside the repo (git-ignored), so every Docker setup can mount it; a temp dir under
// /var/folders isn't shared by all of them.
const OUT_DIR = resolve('out/smoke');

/**
 * The SVG cards to write, the flags for each, and what each must and must not contain on top
 * of a complete document: the two cell styles of a single metric, and a combined graph.
 */
const SVG_EXPECT = {
	matrix: {
		args: ['--cells', 'matrix'],
		has: ['<title>2026-09-08: 2 prompts</title>', 'ui-monospace', 'height="14"'],
		lacks: [' rx="3"']
	},
	wide: {
		args: ['--cells', 'wide'],
		has: ['<title>2026-09-08: 2 prompts</title>', ' rx="3"'],
		lacks: ['ui-monospace']
	},
	bars: {
		args: ['-m', 'prompts,sessions,tokens'],
		has: ['<title>2026-09-08: 2 prompts · 1 agent sessions · 1,400 tokens</title>', 'class="b2"'],
		lacks: ['Less']
	}
} as const;

/**
 * Run a command, capturing its output.
 *
 * @returns exit code, stdout and stderr.
 * Called by: dockerAvailable, checkTarget, checkSvg, module top level.
 * Calls: Bun.spawnSync.
 */
function exec(cmd: string[]): { code: number; stdout: string; stderr: string } {
	const result = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1' } });
	return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/**
 * Check that a Docker daemon is reachable.
 *
 * @returns true if `docker info` succeeds; false if it fails or `docker` isn't installed.
 * Called by: module top level.
 * Calls: exec.
 */
function dockerAvailable(): boolean {
	try {
		return exec(['docker', 'info', '--format', '{{.ServerVersion}}']).code === 0;
	} catch {
		// Bun.spawnSync throws when the executable doesn't exist (e.g. GitHub's macOS runners).
		return false;
	}
}

/**
 * Check that Docker can actually execute binaries of a platform. Pulling a foreign-arch image
 * always works, but running it needs a binfmt_misc handler on the host (qemu-user-binfmt, which
 * replaced qemu-user-static on current Debian/Ubuntu, or Rosetta / QEMU built into Docker
 * Desktop); without one every command fails with `exec format error`.
 *
 * @returns null if a trivial command runs in LINUX_IMAGE on that platform, otherwise why not.
 * Called by: runner.
 * Calls: exec.
 */
function dockerCanRun(platform: string): string | null {
	const probe = exec(['docker', 'run', '--rm', `--platform=${platform}`, LINUX_IMAGE, 'true']);
	if (probe.code === 0) return null;
	if (probe.stderr.includes('exec format error')) {
		return `Docker has no ${platform} emulation (install qemu-user-binfmt, or run docker run --privileged --rm tonistiigi/binfmt --install all)`;
	}
	return `docker run --platform=${platform} failed: ${probe.stderr.trim()}`;
}

/**
 * Decide how to run a target's binary on this machine: directly when OS and CPU match the
 * host; in a Linux container of the target's architecture when Docker is available and can
 * execute that architecture (repo mounted read-only at /work, OUT_DIR writable at /out);
 * otherwise not at all.
 *
 * @returns how to invoke the binary and where it should write files, or why it can't run here.
 * Called by: module top level.
 * Calls: dockerCanRun.
 */
function runner(target: Target, docker: boolean): Runner | string {
	if (target.os === process.platform && target.arch === process.arch) {
		return { how: 'native', wrap: (args) => args, outPath: (name) => join(OUT_DIR, name) };
	}
	if (target.os !== 'linux') return `can't run ${target.os} binaries here`;
	if (!docker) return "can't run this architecture here without Docker";
	const platform = DOCKER_PLATFORM[target.arch];
	const problem = dockerCanRun(platform);
	if (problem) return problem;
	return {
		how: `docker ${platform}`,
		wrap: (args) => [
			'docker',
			'run',
			'--rm',
			`--platform=${platform}`,
			'-v',
			`${process.cwd()}:/work:ro`,
			'-v',
			`${OUT_DIR}:/out`,
			'-w',
			'/work',
			'-e',
			'NO_COLOR=1',
			LINUX_IMAGE,
			...args
		],
		outPath: (name) => `/out/${name}`
	};
}

/**
 * Have the binary write each SVG in SVG_EXPECT from the fixtures and check each file: a
 * complete document with the fixture tooltip, and the style's own geometry and font.
 *
 * @returns null when every SVG passes, otherwise the first problem found.
 * Called by: checkTarget.
 * Calls: exec, readFileSync.
 */
function checkSvg(binary: string, run: Runner, target: string): string | null {
	for (const [style, expect] of Object.entries(SVG_EXPECT)) {
		const name = `${target}-${style}.svg`;
		const result = exec(run.wrap([binary, '--svg', run.outPath(name), ...expect.args, '-w', '520', ...FIXTURES]));
		if (result.code !== 0) return `--svg ${style} exited ${result.code}: ${result.stderr.trim()}`;
		let svg: string;
		try {
			svg = readFileSync(join(OUT_DIR, name), 'utf8');
		} catch {
			// The binary exited 0 but the file isn't where it should be: report that as the failure.
			return `--svg ${style}: no file at ${join(OUT_DIR, name)}`;
		}
		if (!svg.startsWith('<svg ') || !svg.trimEnd().endsWith('</svg>')) return `--svg ${style}: not a complete SVG`;
		const missing = expect.has.find((marker) => !svg.includes(marker));
		if (missing) return `--svg ${style}: missing ${missing}`;
		const unexpected = expect.lacks.find((marker) => svg.includes(marker));
		if (unexpected) return `--svg ${style}: unexpected ${unexpected}`;
	}
	return null;
}

/**
 * Run the checks against one binary: `--version` names this package version and a commit;
 * `--json` over the fixtures gives the expected days and prompts; the terminal output renders
 * and names the fixture transcripts it scanned; `--svg` writes a correct card in both styles.
 *
 * @returns the first failing check's message, or a short success note.
 * Called by: module top level.
 * Calls: exec, checkSvg.
 */
function checkTarget(binary: string, run: Runner, target: string): { ok: boolean; detail: string } {
	const version = exec(run.wrap([binary, '--version']));
	const versionPattern = new RegExp(`^tigergrid ${pkg.version.replaceAll('.', '\\.')} \\([0-9a-f]+(-dirty)?\\)$`);
	if (version.code !== 0 || !versionPattern.test(version.stdout.trim())) {
		return { ok: false, detail: `--version: ${(version.stdout + version.stderr).trim() || `exit ${version.code}`}` };
	}

	const json = exec(run.wrap([binary, '--json', '-w', '520', ...FIXTURES]));
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

	const terminal = exec(run.wrap([binary, '-w', '8', ...FIXTURES]));
	if (terminal.code !== 0 || !terminal.stdout.includes('scanned 3 Claude + 4 Codex transcripts')) {
		return { ok: false, detail: `terminal output: exit ${terminal.code} ${terminal.stderr.trim()}` };
	}

	const svgProblem = checkSvg(binary, run, target);
	if (svgProblem) return { ok: false, detail: svgProblem };
	return {
		ok: true,
		detail: `${version.stdout.trim()}; ${rows.length} days, ${prompts} prompts; svg ${Object.keys(SVG_EXPECT).join(' + ')}`
	};
}

/**
 * The status mark for one result line.
 *
 * @returns ✗ for failed (including a requested target that was skipped), – for skipped, ✓ for passed.
 * Called by: module top level.
 * Calls: nothing.
 */
function markOf(outcome: Outcome): string {
	if (!outcome.ok) return '✗';
	return outcome.how === 'skipped' ? '–' : '✓';
}

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !TARGETS.some((target) => target.name === name));
if (unknown.length) {
	console.error(
		`unknown target(s): ${unknown.join(', ')}; supported: ${TARGETS.map((target) => target.name).join(', ')}`
	);
	process.exit(1);
}
const targets = requested.length ? TARGETS.filter((target) => requested.includes(target.name)) : TARGETS;

const build = exec(['bun', 'scripts/build.ts', ...targets.map((target) => target.name)]);
if (build.code !== 0) {
	console.error(build.stderr);
	process.exit(1);
}
process.stdout.write(build.stdout);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const docker = dockerAvailable();
if (!docker) console.log("docker not available: Linux binaries that don't match this machine are skipped");

const outcomes: Outcome[] = [];
for (const target of targets) {
	const binary = `dist/tigergrid-${target.name.replace(/^bun-/, '')}`;
	const run = runner(target, docker);
	if (typeof run === 'string') {
		// Skipping is fine for a full local run, but a target asked for by name (as in CI) must run.
		const ok = requested.length === 0;
		const detail = `${run}${ok ? '' : ', but it was requested'}`;
		outcomes.push({ target: target.name, how: 'skipped', ok, detail });
		continue;
	}
	outcomes.push({ target: target.name, how: run.how, ...checkTarget(binary, run, target.name) });
}

console.log();
for (const outcome of outcomes) {
	console.log(`${markOf(outcome)} ${outcome.target.padEnd(18)} ${outcome.how.padEnd(20)} ${outcome.detail}`);
}
process.exit(outcomes.every((outcome) => outcome.ok) ? 0 : 1);
