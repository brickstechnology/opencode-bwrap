# opencode-bwrap

An [OpenCode](https://opencode.ai) plugin that overrides the built-in `bash`
tool so **every agent-run shell command executes inside a per-session
[bubblewrap](https://github.com/containers/bubblewrap) jail rooted at
`/workspace`**. Built for the SparkTok worker (one OpenCode process per user,
many concurrent task sessions), where the agent runs untrusted model/repo code.

## What it does

- Each session's bash runs under `bwrap`, with the session's real dir
  (`ctx.directory`, e.g. `/data/worktrees/tasks/<id>`) bound to `/workspace`
  and set as cwd. `pwd` returns `/workspace`.
- The agent **cannot** read outside `/workspace`: no sibling task dirs, no
  `/var/run/secrets`, no pod filesystem beyond a read-only toolchain.
- `--clearenv` + an allowlist **scrub pod secrets** (`OPENROUTER_API_KEY`,
  `SPARKTOK_WORKER_MCP_TOKEN`) out of the shell, while forwarding the egress
  proxy vars + git placeholder creds so `git clone`/`push` still work.
- Per-session and per-command: one OpenCode process can jail many concurrent
  sessions independently (each `bwrap` invocation is its own mount namespace).

## S0 gate findings (BACK-stack worker nodes, `sparktok-workers`, 2026-06-25)

Verified live before writing this plugin:

| Probe | Result |
|---|---|
| unprivileged userns (`unshare -Ur`) | ✅ works (as root in container) |
| bind-mount in userns | ✅ works |
| `bwrap --proc /proc` (fresh procfs) | ❌ **EPERM** — runtime masks `/proc`, kernel forbids fresh procfs in an unprivileged userns |
| `bwrap --bind /proc /proc` | ✅ works — **this is what the plugin uses** |
| per-command overhead | **~4 ms** (30× lean profile = 0.116 s) |

**Constraint baked into `bwrap.ts`:** bind the existing `/proc`, never mount a
fresh one. A fresh procfs would need `securityContext.procMount: Unmasked` on
the pod — which weakens the container's own proc masking, so it's not worth it.
Cost of bind-proc: the jailed bash can *see* container process entries (but
can't signal them across the pid namespace) — a minor info leak.

## Architecture

```
src/bwrap.ts   pure argv builder (the unit-tested heart) — encodes the bind
               profile, --bind /proc, --clearenv allowlist, net-stays-shared
src/bash.ts    custom `bash` tool: spawn bwrap + timeout + output cap + abort
src/config.ts  env-driven knobs (bind list, env allowlist, timeout, output cap)
src/index.ts   plugin entry → { tool: { bash } }
```

## What we lose (overriding the built-in bash)

Verified against the `@opencode-ai/plugin` `ToolContext` — abort, metadata, and
permission prompts are **kept** (`ctx.abort`, object return, `ctx.ask()`). What
we reinherit and reimplement in `bash.ts`:

- **timeout** — a deadline that SIGKILLs the child (`OPENCODE_BWRAP_TIMEOUT_MS`).
- **output truncation** — a byte cap so a runaway can't flood the model context
  (`OPENCODE_BWRAP_OUTPUT_CAP`).
- **live stdout streaming** — NOT restored. A custom tool resolves one result at
  completion, so a long build/test shows a frozen tool card until done. The
  model still receives the full final output; only the live UI view degrades.
  Irrelevant on the autonomous path; a minor regression for interactive chat.

## Usage

```jsonc
// opencode.json
{
  "plugin": ["@bricks/opencode-bwrap"]
}
```

The worker image must have `bubblewrap` installed and the pod must allow
unprivileged user namespaces (confirmed available — see S0).

Config (all optional, env):

| Env | Default | Meaning |
|---|---|---|
| `OPENCODE_BWRAP_RO_BINDS` | `/usr,/bin,/lib,/lib64,/etc` | read-only toolchain binds (existence-filtered) |
| `OPENCODE_BWRAP_ENV_PASS` | proxy/git/CA vars | env allowlist into the jail |
| `OPENCODE_BWRAP_TIMEOUT_MS` | `120000` | per-command hard kill |
| `OPENCODE_BWRAP_OUTPUT_CAP` | `100000` | captured-output byte cap |

## Roadmap

- **File-tool path-guard** — a `tool.execute.before` hook confining
  `read`/`write`/`edit`/`grep` path args to the session root (they run in the
  opencode process, not under bwrap). Deferred; lower severity once the pod is
  non-root + SA-token-dropped + read-only-rootfs.
- **Non-root** — recheck userns/bind-proc as a non-root uid (S5 pod hardening).

## Test

```sh
bun install
bun test
```
