import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { type Plugin, tool } from '@opencode-ai/plugin';
import { buildBwrapArgv, resolveBinds } from './bwrap';
import { CONFIG } from './config';

/** Run a bwrap argv, capture stdout+stderr (capped), forward abort. */
function runJailed(argv: string[], signal?: AbortSignal): Promise<string> {
  return new Promise(resolve => {
    const child = spawn('bwrap', argv, signal ? { signal } : {});
    let buf = '';
    let truncated = false;
    const onData = (d: Buffer) => {
      if (truncated) return;
      buf += d.toString('utf8');
      if (buf.length > CONFIG.outputCap) {
        buf = buf.slice(0, CONFIG.outputCap);
        truncated = true;
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('close', code => resolve(buf + (truncated ? '\n[output truncated]' : '') || `(no output; exit ${code})`));
    child.on('error', err => resolve(`sandbox error: ${String(err)}`));
  });
}

/**
 * The **silent** bash jail (opencode-bwrap). A custom `bash` tool whose card
 * shows the model's own command (`pwd`), while `execute` runs it inside a
 * per-session bubblewrap jail rooted at `/workspace` — the `bwrap …` is never
 * displayed. `ctx.directory` (the session's real dir) is bound to `/workspace`.
 *
 * `tool.execute.before` does NOT fire for a plugin-registered (custom) tool in
 * opencode 1.17, so the own-space dir fix lives in **`chat.message`** instead:
 * it fires at turn start (before any tool runs / before OpenCode's
 * `FileSystem.access` check), and `mkdir -p`s the session dir so an own-space
 * task (which never creates `/data/worktrees/tasks/<id>`) doesn't fail NotFound.
 *
 * Trade-off vs the before-hook rewrite: the displayed command is clean (silent)
 * but a custom tool resolves one result, so live stdout streaming is lost.
 */
export const BwrapJail: Plugin = async ({ client }) => {
  const dirCache = new Map<string, string>();

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

  const bashTool = tool({
    description: 'Execute a bash command in the project shell.',
    args: {
      command: tool.schema.string().describe('The shell command to execute.'),
      description: tool.schema.string().optional().describe('One-line description for the UI.'),
    },
    async execute(args, ctx) {
      await mkdir(ctx.directory, { recursive: true }).catch(() => {});
      const argv = buildBwrapArgv({
        taskDir: ctx.directory,
        command: args.command,
        roBinds: resolveBinds(CONFIG.roBinds),
        envPass: CONFIG.envPass,
      });
      return runJailed(argv, ctx.abort);
    },
  });

  return {
    'chat.message': async input => {
      const dir = await sessionDir(input.sessionID);
      if (dir) await mkdir(dir, { recursive: true }).catch(() => {});
    },
    tool: { bash: bashTool },
  };
};

export default BwrapJail;
