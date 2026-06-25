import { spawn } from 'node:child_process';
import { tool } from '@opencode-ai/plugin';
import { buildBwrapArgv, resolveBinds } from './bwrap';
import { CONFIG } from './config';

interface JailResult {
  output: string;
  metadata: Record<string, unknown>;
}

/**
 * Run one command under bwrap. Reinherits the three things overriding the
 * built-in bash costs us (see README "What we lose"):
 *   - timeout: a deadline that SIGKILLs the child,
 *   - output truncation: cap the buffer so a runaway can't flood the context,
 *   - abort: forward opencode's `ctx.abort` to the child via spawn's `signal`.
 * Live stdout streaming is NOT restored (a custom tool resolves one result).
 */
function runJailed(argv: string[], timeoutMs: number, signal: AbortSignal): Promise<JailResult> {
  return new Promise(resolve => {
    const child = spawn('bwrap', argv, { signal });
    let buf = '';
    let truncated = false;
    const cap = CONFIG.outputCap;

    const onData = (d: Buffer) => {
      if (truncated) return;
      buf += d.toString('utf8');
      if (buf.length > cap) {
        buf = buf.slice(0, cap);
        truncated = true;
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', code => {
      clearTimeout(timer);
      const notes = [
        truncated ? '\n[output truncated]' : '',
        timedOut ? `\n[killed after ${timeoutMs}ms timeout]` : '',
      ].join('');
      resolve({
        output: buf + notes || `(no output; exit ${code})`,
        metadata: { exit: code, truncated, timedOut },
      });
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ output: `sandbox error: ${String(err)}`, metadata: { error: true } });
    });
  });
}

/**
 * Drop-in override of opencode's built-in `bash` tool: every agent-run shell
 * command executes inside a per-session bubblewrap jail rooted at `/workspace`
 * (the session's real dir, `ctx.directory`). The agent cannot read files
 * outside its task dir, the pod's mounted secrets, or other tasks' work.
 */
export const bashTool = tool({
  description:
    'Run a shell command inside an isolated sandbox rooted at /workspace. The ' +
    'command cannot read files outside /workspace, the pod secrets, or other tasks.',
  args: {
    command: tool.schema.string().describe('The shell command to execute.'),
    description: tool.schema.string().optional().describe('One-line description for the UI.'),
    timeout: tool.schema.number().optional().describe('Timeout in ms (default 120000).'),
  },
  async execute(args, ctx) {
    const argv = buildBwrapArgv({
      taskDir: ctx.directory,
      command: args.command,
      roBinds: resolveBinds(CONFIG.roBinds),
      envPass: CONFIG.envPass,
    });
    return runJailed(argv, args.timeout ?? CONFIG.timeoutMs, ctx.abort);
  },
});
