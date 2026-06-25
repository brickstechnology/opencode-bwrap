import { DEFAULT_ENV_PASS, DEFAULT_RO_BINDS } from './bwrap';

const list = (k: string, d: readonly string[]): readonly string[] => {
  const v = process.env[k];
  return v
    ? v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : d;
};

/**
 * Env-driven config so the bind profile + env allowlist are tunable without a
 * rebuild. Timeout + output truncation are intentionally absent — the built-in
 * bash tool we wrap still owns those (and the live output stream).
 */
export const CONFIG = {
  roBinds: list('OPENCODE_BWRAP_RO_BINDS', DEFAULT_RO_BINDS),
  envPass: list('OPENCODE_BWRAP_ENV_PASS', DEFAULT_ENV_PASS),
};
