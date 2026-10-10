# Coding conventions

Most of this code is drafted by models, which write code that compiles flawlessly and reads like a compile target. These rules make it readable for people. `bun run lint`, `bun run check` and `bun run format:check` must pass; the pre-commit hook runs all three plus `bun test`.

## 1. Types

### 1.1 No `any`, including the hidden kind

Explicit `any` is a lint error. The hidden kind never says the word: `JSON.parse`, `Response.json()`, `Bun.file().json()` and `Array.isArray` all hand back `any`. Lint is type-aware (`recommendedTypeChecked`, the `no-unsafe-*` rules) to catch them. Assign such values to `unknown` and narrow (§1.3).

### 1.2 Where types live: `types/`

Exported `type`s and `interface`s live in `types/`, one file per domain, type-only: no functions, no consts. An exported type anywhere else is a lint error (`no-restricted-syntax`). Unexported local types are fine.

### 1.3 The boundary rule: `unknown` in, typed out

Data that enters the program, such as a transcript line, git output or a JSON file, is `unknown` until something narrows it. Transcript fields are read through `src/json.ts` (`asObject`, `asString`, `asNumber`, `asArray`), so a field of the wrong type reads as absent. An `as` anywhere else needs a comment saying what the compiler can't know.

### 1.4 Errors

`catch (error: unknown)`, then `error instanceof Error ? error.message : String(error)`. An empty `catch {}` carries a comment saying why swallowing is correct there.

## 2. Readability

### 2.1 Name things what they are

Single-letter names are a lint error (`id-length`, min 2). `days.map((day) => day.commits)`, not `days.map((d) => d.commits)`. Exceptions: `_` for a deliberately unused binding, and object keys. Comparator sides are `(left, right)`.

### 2.2 A decision table is not a ternary chain

Nested ternaries are a lint error. A named function with early returns says the same thing and can be read aloud.

### 2.3 One statement per line, one binding per declaration

`max-statements-per-line` and `one-var: never`.

### 2.4 Brace anything that wraps

`curly: multi-line`. A single-line guard (`if (!key) return;`) stays as it is; a condition and body on separate lines get braces.

### 2.5 Every function has a JSDoc

What it does, what it returns, who calls it and what it calls (`Called by:` / `Calls:`). No rule checks this; review does.
