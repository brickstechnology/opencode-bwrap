import { expect, test } from 'bun:test';
import { buildBwrapArgv, DEFAULT_ENV_PASS } from '../src/bwrap';

/** `--setenv K V` appears as three consecutive argv entries; find V for K. */
function setenvValue(argv: string[], key: string): string | undefined {
  for (let i = 0; i < argv.length - 2; i++) {
    if (argv[i] === '--setenv' && argv[i + 1] === key) return argv[i + 2];
  }
  return undefined;
}

test('gog placeholders are forwarded through the jail (clearenv + allowlist)', () => {
  process.env.GOG_ACCESS_TOKEN = 'placeholder';
  process.env.GOG_ACCOUNT = 'auto';
  const argv = buildBwrapArgv({ taskDir: '/data/x', command: 'gog drive ls' });
  expect(argv).toContain('--clearenv');
  expect(setenvValue(argv, 'GOG_ACCESS_TOKEN')).toBe('placeholder');
  expect(setenvValue(argv, 'GOG_ACCOUNT')).toBe('auto');
});

test('worker secrets are NOT forwarded into agent bash', () => {
  process.env.OPENROUTER_API_KEY = 'sk-secret';
  process.env.SPARKTOK_WORKER_MCP_TOKEN = 'mcp-secret';
  const argv = buildBwrapArgv({ taskDir: '/data/x', command: 'env' });
  expect(setenvValue(argv, 'OPENROUTER_API_KEY')).toBeUndefined();
  expect(setenvValue(argv, 'SPARKTOK_WORKER_MCP_TOKEN')).toBeUndefined();
  expect(DEFAULT_ENV_PASS).not.toContain('OPENROUTER_API_KEY');
});
