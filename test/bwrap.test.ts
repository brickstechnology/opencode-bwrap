import { describe, expect, test } from 'bun:test';
import { buildBwrapArgv } from '../src/bwrap';

/** Collect the [src, dst] pairs for a given bwrap flag. */
const pairs = (argv: string[], flag: string): string[][] => {
  const out: string[][] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) out.push([argv[i + 1], argv[i + 2]]);
  }
  return out;
};

describe('buildBwrapArgv', () => {
  const argv = buildBwrapArgv({
    taskDir: '/data/worktrees/tasks/abc',
    command: 'pwd',
    roBinds: ['/usr', '/bin'],
  });

  test('binds the task dir to /workspace and chdirs there', () => {
    expect(pairs(argv, '--bind')).toContainEqual(['/data/worktrees/tasks/abc', '/workspace']);
    expect(argv[argv.indexOf('--chdir') + 1]).toBe('/workspace');
  });

  test('binds /proc — never a fresh --proc (S0 proc-masking constraint)', () => {
    expect(pairs(argv, '--bind')).toContainEqual(['/proc', '/proc']);
    expect(argv).not.toContain('--proc');
  });

  test('isolates namespaces but keeps net shared for the egress proxy', () => {
    expect(argv).toContain('--unshare-pid');
    expect(argv).toContain('--unshare-user');
    expect(argv).not.toContain('--unshare-net');
  });

  test('clears env and never forwards model/worker secrets', () => {
    process.env.OPENROUTER_API_KEY = 'sk-leak';
    process.env.SPARKTOK_WORKER_MCP_TOKEN = 'tok-leak';
    const a = buildBwrapArgv({ taskDir: '/t', command: 'env', roBinds: [] });
    expect(a).toContain('--clearenv');
    expect(a.join(' ')).not.toContain('sk-leak');
    expect(a.join(' ')).not.toContain('tok-leak');
  });

  test('forwards an allowlisted proxy var when present', () => {
    process.env.HTTPS_PROXY = 'http://proxy:8080';
    const a = buildBwrapArgv({ taskDir: '/t', command: 'env', roBinds: [] });
    expect(pairs(a, '--setenv')).toContainEqual(['HTTPS_PROXY', 'http://proxy:8080']);
  });

  test('runs the command via bash -lc as the final argv', () => {
    const a = buildBwrapArgv({ taskDir: '/t', command: 'echo hi', roBinds: [] });
    expect(a.slice(-3)).toEqual(['bash', '-lc', 'echo hi']);
  });
});
