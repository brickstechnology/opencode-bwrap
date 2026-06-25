import type { Plugin } from '@opencode-ai/plugin';
import { bashTool } from './bash';

/**
 * opencode-bwrap — override the built-in `bash` tool so every agent-run shell
 * command executes inside a per-session bubblewrap jail rooted at `/workspace`
 * (the session's real dir, `ctx.directory`). Filesystem-confines arbitrary
 * model/repo code and scrubs pod secrets from the shell env.
 *
 * Only `bash` is overridden — the path-based file tools (read/write/edit/grep)
 * are confined separately by a `tool.execute.before` path-guard (a deferred
 * follow-up; see README "Roadmap"). Loaded via opencode's `plugin` config key.
 */
export const BwrapJail: Plugin = async () => ({
  tool: { bash: bashTool },
});

export default BwrapJail;
