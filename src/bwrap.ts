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

export interface BwrapOptions {
  /** Real per-session dir (opencode `ctx.directory`) → bound to `/workspace`. */
  taskDir: string;
  /** The shell command the agent asked to run. */
  command: string;
  /** Read-only binds; caller existence-filters via {@link resolveBinds}. */
  roBinds?: readonly string[];
  /** Env var names to forward; all others are cleared. */
  envPass?: readonly string[];
  /** Mount point the task dir appears at inside the jail. */
  workspace?: string;
}

/** Filter a bind list to paths that exist (`/lib64` is absent on arm64). */
export function resolveBinds(binds: readonly string[] = DEFAULT_RO_BINDS): string[] {
  return binds.filter(p => existsSync(p));
}

/**
 * Build the `bwrap` argv for one jailed command. Encodes the S0 gate findings
 * measured on the BACK-stack worker nodes (sparktok-workers ns, 2026-06-25):
 *
 *   - `--bind /proc /proc`, NOT `--proc /proc`: the container runtime masks
 *     parts of /proc, so an unprivileged user namespace is forbidden from
 *     mounting a fresh procfs (EPERM). Binding the existing proc works.
 *   - net is left SHARED (no `--unshare-net`) — the egress proxy (ADR-178)
 *     must stay reachable for git clone/push.
 *   - `--clearenv` + an allowlist scrub the model/worker secrets the opencode
 *     process carries out of the agent's shell.
 *
 * Pure assembly: callers resolve bind existence + supply the env; this only
 * builds the argv array (the unit-tested heart of the plugin).
 */
export function buildBwrapArgv(opts: BwrapOptions): string[] {
  const ws = opts.workspace ?? '/workspace';
  const argv: string[] = [];

  for (const p of opts.roBinds ?? resolveBinds()) {
    argv.push('--ro-bind', p, p);
  }

  argv.push(
    '--bind', '/proc', '/proc', // S0: fresh `--proc` is EPERM under proc-masking
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--bind', opts.taskDir, ws,
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
    const v = process.env[k];
    if (v !== undefined) argv.push('--setenv', k, v);
  }
  argv.push('--setenv', 'HOME', ws, '--setenv', 'PWD', ws);

  argv.push('bash', '-lc', opts.command);
  return argv;
}
