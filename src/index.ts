import { mkdir } from 'node:fs/promises';
import type { Plugin } from '@opencode-ai/plugin';
import { wrapBashCommand } from './bwrap';
import { CONFIG } from './config';

/**
 * opencode-bwrap — confine the OpenCode agent's shell. We hook
 * `tool.execute.before` and rewrite the built-in `bash` tool's command so it
 * re-execs inside a per-session bubblewrap jail rooted at `/workspace` (the
 * session's real cwd). Filesystem-confines arbitrary model/repo code and scrubs
 * pod secrets from the shell env — while the built-in bash keeps its live output
 * streaming, timeout, and truncation (we modify its args, not replace the tool;
 * registering a same-name tool merely duplicates it in opencode 1.17).
 *
 * Before rewriting, the hook **ensures the session cwd exists**. OpenCode
 * `FileSystem.access`-checks the session directory (e.g.
 * `/data/worktrees/tasks/<id>`) before running bash, and an own-space SparkTok
 * task never creates that dir (the backend can't mkdir the worker PVC, and the
 * first-turn clone recipe only mkdir's when the task has repos) — so the check
 * fails `NotFound` and bash errors. The hook runs (and is awaited) BEFORE that
 * check, so creating the dir here makes the jail self-sufficient for its own cwd.
 *
 * Path-based file tools (read/write/edit/grep) are a deferred follow-up (a
 * path-guard in the same hook); see README "Roadmap". Loaded via the `plugin`
 * config key.
 */
export const BwrapJail: Plugin = async ({ client }) => {
  const dirCache = new Map<string, string>();

  /** Resolve a session's working directory (cached); undefined if unavailable. */
  async function sessionDir(id: string): Promise<string | undefined> {
    const cached = dirCache.get(id);
    if (cached) return cached;
    try {
      const { data } = await client.session.get({ path: { id } });
      const dir = data?.directory;
      if (dir) dirCache.set(id, dir);
      return dir;
    } catch {
      return undefined;
    }
  }

  return {
    'tool.execute.before': async (input, output) => {
      if (input.tool !== 'bash' || typeof output.args?.command !== 'string') {
        return;
      }
      const dir = await sessionDir(input.sessionID);
      if (dir) {
        // best-effort: if it fails, OpenCode's original NotFound surfaces unchanged
        try {
          await mkdir(dir, { recursive: true });
        } catch {
          /* ignore */
        }
      }
      output.args.command = wrapBashCommand(output.args.command, {
        roBinds: CONFIG.roBinds,
        envPass: CONFIG.envPass,
      });
    },
  };
};

export default BwrapJail;
