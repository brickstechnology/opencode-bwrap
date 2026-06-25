import { DEFAULT_ENV_PASS, DEFAULT_RO_BINDS } from './bwrap';

const num = (k: string, d: number): number => {
  const v = process.env[k];
  const n = v ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : d;
};

const list = (k: string, d: readonly string[]): readonly string[] => {
  const v = process.env[k];
  return v
    ? v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : d;
};

/** Env-driven config so the bind profile + caps are tunable without a rebuild. */
export const CONFIG = {
  roBinds: list('OPENCODE_BWRAP_RO_BINDS', DEFAULT_RO_BINDS),
  envPass: list('OPENCODE_BWRAP_ENV_PASS', DEFAULT_ENV_PASS),
  /** Hard kill a command after this many ms (the built-in bash timeout we lose). */
  timeoutMs: num('OPENCODE_BWRAP_TIMEOUT_MS', 120_000),
  /** Cap captured output so a runaway command can't blow the model context. */
  outputCap: num('OPENCODE_BWRAP_OUTPUT_CAP', 100_000),
};
