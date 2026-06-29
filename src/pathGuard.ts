import { realpathSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';

/**
 * The built-in file tools run UNJAILED (in the opencode process, as root), so
 * without a guard the agent can `read /proc/self/environ` (→ OPENROUTER_API_KEY),
 * `read /var/run/secrets/…`, or touch a sibling task — and the egress proxy
 * passes non-listed hosts straight through, so it can exfiltrate. This guard runs
 * in `tool.execute.before` (which DOES fire for built-in tools, unlike the custom
 * `bash` tool) and rejects any file-tool path that resolves outside the session
 * root — giving the file tools the same `/workspace` boundary the bwrap jail
 * already gives bash. ADR-268.
 */

/** The path-arg key per built-in file tool. `path` (grep/glob) is optional. */
const PATH_ARG: Record<string, string | undefined> = {
  read: 'filePath',
  write: 'filePath',
  edit: 'filePath',
  grep: 'path',
  glob: 'path',
  list: 'path',
};

/** Resolve `p` (relative → against `root`) to a canonical absolute path. */
function resolveSafe(p: string, root: string): string {
  const abs = resolve(root, p);
  try {
    return realpathSync(abs); // existing file/dir — resolves symlinks
  } catch {
    // new file (write/edit): canonicalise the existing parent, append basename
    try {
      return resolve(realpathSync(dirname(abs)), basename(abs));
    } catch {
      return abs;
    }
  }
}

/** True if `p` resolves within `root` (canonical + symlink-safe). */
export function withinRoot(p: string, root: string): boolean {
  let r: string;
  try {
    r = realpathSync(root);
  } catch {
    r = resolve(root);
  }
  const t = resolveSafe(p, root);
  return t === r || t.startsWith(r + sep);
}

/**
 * Throw if a file tool's path arg escapes `root`. No-op for non-file tools, for a
 * missing/optional path (grep/glob default to cwd = the root), or when the session
 * dir is unknown. Throwing in `tool.execute.before` aborts the tool call.
 */
export function guardPath(
  tool: string,
  args: unknown,
  root: string | undefined,
): void {
  const key = PATH_ARG[tool];
  if (!key || !root || typeof args !== 'object' || args === null) return;
  const p = (args as Record<string, unknown>)[key];
  if (typeof p !== 'string' || p === '') return;
  if (!withinRoot(p, root)) {
    throw new Error(
      `opencode-bwrap: '${p}' is outside the workspace — blocked. The agent may only read/write files under its task directory.`,
    );
  }
}
