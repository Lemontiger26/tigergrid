# agentgrid

A GitHub-style contribution graph of your AI coding agents: Claude Code and Codex sessions, prompts and tokens, plus the share of your git commits that agents co-authored. Everything is read locally; nothing leaves the machine.

```sh
bun install
bun src/cli.ts                      # prompts, last ~52 weeks (fits terminal width)
bun src/cli.ts -m tokens -t claude  # Claude Code tokens only
bun src/cli.ts -m ai --svg ai.svg   # AI-assisted commits, plus an embeddable SVG
bun src/cli.ts --json               # per-day data
```

Metrics: `prompts` · `sessions` · `tokens` · `commits` · `ai`. Run with `--help` for all flags.

## Sources and counting rules

| Source | Location | Notes |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Prompts = human user turns (no tool results, slash-command echoes, meta or sidechain messages). Usage is deduplicated by message id because one response spans several lines. |
| Codex | `~/.codex/sessions`, `~/.codex/archived_sessions` | Prompts = `task_started` turns outside sub-agent threads. Threads listed in `external_agent_session_imports.json` are skipped: they are copies of Claude Code sessions, already counted at the source. |
| git | repos under `--git-root` (default `~/develop`, depth 4) | Filtered by `--author` (default `git config user.email`), deduplicated by hash across worktrees. "AI-assisted" = an agent `Co-Authored-By` trailer or a `Generated with …` footer. |

`tokens` means fresh tokens: uncached input + cache writes + output. Cache reads are excluded because they would swamp everything else.

## Known limits

- Claude Code deletes transcripts after `cleanupPeriodDays` (default 30), so history only goes back as far as you've kept it. Raise that setting if you want a full year.
- Codex's legacy→paginated history migration restamped some old threads with the migration time. Imported threads are filtered out; any remaining native ones show up on the migration date.
- Levels are GitHub-style quartiles over the active days in view, so colours are relative, not absolute.
