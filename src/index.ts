import type { Plugin } from '@opencode-ai/plugin';
import { wrapBashCommand } from './bwrap';
import { CONFIG } from './config';

/**
 * opencode-bwrap — confine the OpenCode agent's shell. We hook
 * `tool.execute.before` and rewrite the built-in `bash` tool's command so it
 * re-execs inside a per-session bubblewrap jail rooted at `/workspace` (the
 * session's real cwd). Filesystem-confines arbitrary model/repo code and scrubs
 * pod secrets from the shell env — while the built-in bash keeps its live
 * output streaming, timeout, and truncation (we modify its args, not replace
 * the tool; registering a same-name tool merely duplicates it in opencode 1.17).
 *
 * The path-based file tools (read/write/edit/grep) are a deferred follow-up
 * (a path-guard in the same hook); see README "Roadmap". Loaded via the
 * `plugin` config key.
 */
export const BwrapJail: Plugin = async () => ({
  'tool.execute.before': async (input, output) => {
    if (input.tool === 'bash' && typeof output.args?.command === 'string') {
      output.args.command = wrapBashCommand(output.args.command, {
        roBinds: CONFIG.roBinds,
        envPass: CONFIG.envPass,
      });
    }
  },
});

export default BwrapJail;
