# opencode-bwrap

An [OpenCode](https://opencode.ai) plugin that confines the agent's shell:
it registers a **custom `bash` tool** that runs every command inside a
per-session [bubblewrap](https://github.com/containers/bubblewrap) jail rooted at
`/workspace`. Built for the SparkTok worker (one OpenCode process per user, many
concurrent task sessions), where the agent runs untrusted model/repo code.

## Silent by design

The tool card shows the model's **own command** (`pwd`) — the `bwrap …` wrapper
runs *inside* the tool's `execute` and is never displayed. (An earlier version
rewrote the command via `tool.execute.before`, which surfaced the whole bwrap
line in the UI; the custom tool keeps it hidden.)

## What it does

- Each bash command runs under `bwrap`, with the session's real dir
  (`ctx.directory`) bound to `/workspace` and set as cwd. `pwd` returns
  `/workspace`.
- The agent **cannot** read outside `/workspace`: no sibling task dirs, no
  `/var/run/secrets`, no pod filesystem beyond a read-only toolchain.
- `--clearenv` + an allowlist **scrub pod secrets** (`OPENROUTER_API_KEY`,
  `SPARKTOK_WORKER_MCP_TOKEN`) out of the shell, while forwarding the egress
  proxy vars + git placeholder creds so `git clone`/`push` still work.
- Per-session, per-command: each `bwrap` invocation is its own mount namespace.
- **Creates the session cwd first.** OpenCode `FileSystem.access`-checks the
  session dir before running a tool, and an own-space SparkTok task never creates
  `/data/worktrees/tasks/<id>`. Since **`tool.execute.before` does NOT fire for a
  custom tool**, the dir is created in **`chat.message`** instead — it fires at
  turn start, before any tool / the access check. (`execute` also mkdir's, as a
  backstop for the bind.)

## Trade-off

The custom tool is **silent** but resolves a single result, so **live stdout
streaming is lost** (a long build/test shows a frozen card until it finishes; the
model still receives the full output). The visible-but-streaming alternative is
the `tool.execute.before` rewrite — see git history.

## S0 gate findings (BACK-stack worker nodes, 2026-06-26)

| Probe | Result |
|---|---|
| unprivileged userns | ✅ works |
| `bwrap --proc /proc` (fresh) | ❌ EPERM (runtime masks /proc) → use `--bind /proc /proc` |
| per-command overhead | ~4 ms |

## Architecture

```
src/bwrap.ts   buildBwrapArgv() → the spawn argv (binds ctx.directory) — unit-tested
src/config.ts  env-driven knobs (binds, env allowlist, output cap)
src/index.ts   custom bash tool (bwrap in execute) + chat.message (mkdir session dir)
```

## Usage

```jsonc
// opencode.json
{ "plugin": ["@bricks/opencode-bwrap"] }
```

The worker image must have `bubblewrap` installed and the pod must allow
unprivileged user namespaces.

## Test

```sh
bun install && bun test
```
