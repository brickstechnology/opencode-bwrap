import { existsSync } from 'node:fs';

/** Read-only toolchain dirs bound into every jail. `/lib64` is arch-dependent. */
export const DEFAULT_RO_BINDS = ['/usr', '/bin', '/lib', '/lib64', '/etc'] as const;

/**
 * Env vars allowed into the jailed shell. Everything else is dropped via
 * `--clearenv`, so the secrets the opencode process holds — `OPENROUTER_API_KEY`,
 * `SPARKTOK_WORKER_MCP_TOKEN` — never reach agent-run bash. The ADR-178 egress
 * proxy vars + git placeholder creds + the CA path ARE forwarded so clone/push
 * still work (the proxy injects the real per-user token at egress).
 */
export const DEFAULT_ENV_PASS = [
  'PATH',
  'LANG',
  'LC_ALL',
  'TERM',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'GIT_CONFIG_KEY_1',
  'GIT_CONFIG_VALUE_1',
  'GH_TOKEN',
  'GH_HOST',
  'GIT_SSL_CAINFO',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
] as const;

export interface WrapOptions {
  /** Read-only binds; existence-filtered at runtime via {@link resolveBinds}. */
  roBinds?: readonly string[];
  /** Env var names to forward into the jail; all others are cleared. */
  envPass?: readonly string[];
  /** Mount point the task dir appears at inside the jail. */
  workspace?: string;
}

/** Filter a bind list to paths that exist (`/lib64` is absent on arm64). */
export function resolveBinds(binds: readonly string[] = DEFAULT_RO_BINDS): string[] {
  return binds.filter(p => existsSync(p));
}

/** POSIX single-quote escape for a shell literal. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Rewrite a bash command so it runs inside a per-session bubblewrap jail rooted
 * at `/workspace`. Returned as a **shell string** the built-in OpenCode `bash`
 * tool will exec — NOT a spawn argv. We hook `tool.execute.before` and replace
 * `output.args.command` with this (OpenCode's documented pattern for modifying
 * bash), rather than registering a competing `bash` tool — which in opencode
 * 1.17 *adds a duplicate* instead of replacing, and would forfeit the built-in's
 * live output streaming + timeout. This keeps all of that.
 *
 * Key points, verified on the BACK-stack worker nodes (S0/S1, 2026-06-25):
 *   - `--bind /proc /proc`, NOT `--proc /proc`: the runtime masks /proc, so a
 *     fresh procfs in an unprivileged userns is EPERM.
 *   - `--bind "$(pwd)" /workspace`: the built-in bash already runs in the
 *     session's real dir, so `$(pwd)` (expanded by its own shell) binds exactly
 *     that — no session lookup needed.
 *   - net left SHARED (no `--unshare-net`) for the ADR-178 egress proxy.
 *   - `--clearenv` + an allowlist (forwarded as `"$VAR"`, expanded by the outer
 *     shell, only when set) scrub the model/worker secrets out of agent bash.
 */
export function wrapBashCommand(command: string, opts: WrapOptions = {}): string {
  const ws = opts.workspace ?? '/workspace';
  const parts: string[] = ['exec', 'bwrap'];

  for (const p of resolveBinds(opts.roBinds)) {
    parts.push('--ro-bind', p, p);
  }

  parts.push(
    '--bind', '/proc', '/proc', // S0: fresh `--proc` is EPERM under proc-masking
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--bind', '"$(pwd)"', ws, // the outer shell's cwd = the session's real dir
    '--chdir', ws,
    '--unshare-user',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup', // net deliberately left shared for the egress proxy
    '--die-with-parent',
    '--clearenv',
  );

  for (const k of opts.envPass ?? DEFAULT_ENV_PASS) {
    if (process.env[k] !== undefined) {
      parts.push('--setenv', k, `"$${k}"`); // expanded by the outer shell
    }
  }
  parts.push('--setenv', 'HOME', ws, '--setenv', 'PWD', ws);

  parts.push('bash', '-lc', shq(command));
  return parts.join(' ');
}
