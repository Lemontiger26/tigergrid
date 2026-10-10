# Test fixtures

One fictional developer (`dev@acme.test`) working on two projects, `acme/api` and `acme/web`, during the week of **Mon 2026-09-07 to Sun 2026-09-13**. Most tests pass `since = 2026-09-01` and treat **Sat 2026-09-12** as today.

Every transcript line is written to cover one rule. Lines that must *not* count start with `NOT A PROMPT:`, and the ones that must count start with `PROMPT n:`.

## Files

| Path | What it covers |
| --- | --- |
| `claude/-Users-dev-acme-api/claude-api-1.jsonl` | Real prompts (string and text-block forms); one response split over two lines that must count once; cache reads that must be ignored; a tool result, a slash-command echo, a meta message and a task notification that are not prompts; an old record before `since`; a truncated last line |
| `claude/-Users-dev-acme-web/claude-web-1.jsonl` | A second session in a second project |
| `claude/-Users-dev-acme-web/claude-web-1/subagents/agent-explore.jsonl` | A sub-agent: its tokens count, its prompt doesn't |
| `codex/sessions/2026/09/10/…codex-native-1.jsonl` | New-style rollout: `token_usage_record` deduplicated by `response_id`; a stray `token_count` that must be ignored; a second turn on the next day |
| `codex/sessions/2026/09/10/…codex-subagent-1.jsonl` | Sub-agent thread whose second `session_meta` is the parent's: tokens count, no prompt, no session |
| `codex/sessions/2026/09/20/…codex-imported-1.jsonl` | Thread Codex imported from Claude Code, restamped with the import time. Skipped completely |
| `codex/archived_sessions/…codex-legacy-1.jsonl` | Old-style rollout: only `token_count` events, one repeated total that must be skipped |
| `codex/external_agent_session_imports.json` | The import ledger that names `codex-imported-1` |
| `git/repos.json` | Turned into real repos in a temp dir by `test/helpers/git-fixture.ts`: AI and human commits, a colleague's commit, an old commit, a clone (same hashes), a repo in `node_modules`, and one past the depth limit |

## Expected results (`since = 2026-09-01`)

Tokens are *fresh* tokens: uncached input + cache writes + output for Claude, input − cached input + output for Codex.

| Day | Claude prompts | Claude tokens | Codex prompts | Codex tokens | Commits (mine) | AI-assisted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tue 09-08 | 2 | 1,400 = 1,300 + 100 | – | – | 2 | 1 |
| Wed 09-09 | 2 | 750 = 50 + 200 + 500 (sub-agent) | – | – | 1 | 1 |
| Thu 09-10 | – | – | 1 | 1,150 = 250 + 600 + 300 (sub-agent) | – | – |
| Fri 09-11 | – | – | 1 | 10 | – | – |
| Sat 09-12 | – | – | 1 | 1,200 = 700 + 500 | 1 | 1 |
| Sun 09-20 | – | – | – (imported, skipped) | – | – | – |

- **Sessions:** Claude `claude-api-1` (09-08, 09-09) and `claude-web-1` (09-09); Codex `codex-native-1` (09-10, 09-11) and `codex-legacy-1` (09-12).
- **Projects** (prompts): `acme/api` 5, `acme/web` 2.
- **Repos found:** 3 (`acme/api`, `acme/web`, `forks/api-clone`).

The end-to-end CLI tests use a 520-week window, so they also pick up the **2026-08-01** records: 1 Claude prompt and 1 commit. That gives 8 prompts, 5 commits and 3 AI-assisted (60%) overall.
