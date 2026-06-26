# opencode-bwrap

An [OpenCode](https://opencode.ai) plugin that confines the agent's shell:
it hooks `tool.execute.before` and **rewrites the built-in `bash` tool's command
so it re-execs inside a per-session [bubblewrap](https://github.com/containers/bubblewrap)
jail rooted at `/workspace`**. Built for the SparkTok worker (one OpenCode
process per user, many concurrent task sessions), where the agent runs untrusted
model/repo code.

## What it does

- Each bash command runs under `bwrap`, with the session's real dir (the built-in
  bash's own cwd, captured via `$(pwd)`) bound to `/workspace` and set as cwd.
  `pwd` returns `/workspace`.
- The agent **cannot** read outside `/workspace`: no sibling task dirs, no
  `/var/run/secrets`, no pod filesystem beyond a read-only toolchain.
- `--clearenv` + an allowlist **scrub pod secrets** (`OPENROUTER_API_KEY`,
  `SPARKTOK_WORKER_MCP_TOKEN`) out of the shell, while forwarding the egress
  proxy vars + git placeholder creds so `git clone`/`push` still work.
- Per-session and per-command: each `bwrap` invocation is its own mount
  namespace, so concurrent sessions in one process never collide.
- **Ensures the session cwd exists first.** OpenCode `FileSystem.access`-checks
  the session directory before running bash; an own-space SparkTok task never
  creates `/data/worktrees/tasks/<id>` (the backend can't mkdir the worker PVC),
  so the hook `mkdir -p`s it before rewriting — the jail is self-sufficient for
  its own cwd.

## Why a `tool.execute.before` rewrite (not a `bash` tool override)

Registering a `tool: { bash }` with the built-in's name **does not replace it in
opencode 1.17 — it adds a duplicate** (both bash tools end up advertised to the
model; verified via `/experimental/tool`). OpenCode's documented pattern for
modifying bash is to mutate `output.args.command` in `tool.execute.before` — so
that's what we do. The big win: the **built-in bash still runs the command**, so
its **live output streaming, timeout, and truncation are all preserved**. We
modify its args; we don't own a bash tool.

`--bind "$(pwd)" /workspace` works because the built-in bash already runs in the
session's real dir, so its own shell expands `$(pwd)` to exactly that — no
session lookup needed.

## S0 gate findings (BACK-stack worker nodes, `sparktok-workers`, 2026-06-25)

Verified live before writing this plugin:

| Probe | Result |
|---|---|
| unprivileged userns (`unshare -Ur`) | ✅ works (as root in container) |
| bind-mount in userns | ✅ works |
| `bwrap --proc /proc` (fresh procfs) | ❌ **EPERM** — runtime masks `/proc`, kernel forbids a fresh procfs in an unprivileged userns |
| `bwrap --bind /proc /proc` | ✅ works — **this is what the plugin uses** |
| per-command overhead | **~4 ms** (30× lean profile = 0.116 s) |

A fresh procfs would need `securityContext.procMount: Unmasked` (weakens the
container's own masking — not worth it). Bind-proc's only cost: the jailed shell
can *see* container process entries but can't signal across the pid namespace.

## Architecture

```
src/bwrap.ts   wrapBashCommand(cmd) → the bwrap shell-string (the unit-tested core):
               bind profile, --bind /proc, --bind "$(pwd)" /workspace, --clearenv allowlist
src/config.ts  env-driven knobs (bind list, env allowlist)
src/index.ts   plugin entry → tool.execute.before rewrites the bash command
```

## Usage

```jsonc
// opencode.json
{
  "plugin": ["@bricks/opencode-bwrap"]   // or an absolute path to src/index.ts
}
```

The worker image must have `bubblewrap` installed and the pod must allow
unprivileged user namespaces (confirmed available — see S0).

Config (all optional, env):

| Env | Default | Meaning |
|---|---|---|
| `OPENCODE_BWRAP_RO_BINDS` | `/usr,/bin,/lib,/lib64,/etc` | read-only toolchain binds (existence-filtered) |
| `OPENCODE_BWRAP_ENV_PASS` | proxy/git/CA vars | env allowlist into the jail |

## Roadmap

- **File-tool path-guard** — extend the same `tool.execute.before` hook to confine
  `read`/`write`/`edit`/`grep` path args (resolving symlinks via `realpath`) to
  the session root. Deferred; lower severity once the pod is non-root +
  SA-token-dropped + read-only-rootfs.
- **Non-root** — recheck userns/bind-proc as a non-root uid (pod hardening).

## Test

```sh
bun install
bun test
```
