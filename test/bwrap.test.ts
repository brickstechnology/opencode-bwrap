import { describe, expect, test } from 'bun:test';
import { wrapBashCommand } from '../src/bwrap';

describe('wrapBashCommand', () => {
  const cmd = wrapBashCommand('pwd', { roBinds: ['/usr', '/bin'] });

  test('execs bwrap and binds the session cwd to /workspace', () => {
    expect(cmd.startsWith('exec bwrap ')).toBe(true);
    // $(pwd) is left for the outer shell (the built-in bash, already in the
    // session dir) to expand → binds the real task dir to /workspace.
    expect(cmd).toContain('--bind "$(pwd)" /workspace');
    expect(cmd).toContain('--chdir /workspace');
  });

  test('binds /proc — never a fresh --proc (S0 proc-masking constraint)', () => {
    expect(cmd).toContain('--bind /proc /proc');
    expect(cmd).not.toContain('--proc /proc');
  });

  test('isolates namespaces but keeps net shared for the egress proxy', () => {
    expect(cmd).toContain('--unshare-pid');
    expect(cmd).toContain('--unshare-user');
    expect(cmd).not.toContain('--unshare-net');
  });

  test('clears env and never embeds model/worker secret values', () => {
    process.env.OPENROUTER_API_KEY = 'sk-leak';
    process.env.SPARKTOK_WORKER_MCP_TOKEN = 'tok-leak';
    const c = wrapBashCommand('env', { roBinds: [] });
    expect(c).toContain('--clearenv');
    expect(c).not.toContain('sk-leak');
    expect(c).not.toContain('tok-leak');
    expect(c).not.toContain('OPENROUTER_API_KEY');
  });

  test('forwards an allowlisted proxy var by reference (outer-shell expansion)', () => {
    process.env.HTTPS_PROXY = 'http://proxy:8080';
    const c = wrapBashCommand('env', { roBinds: [] });
    // forwarded as "$HTTPS_PROXY" — the value is NOT baked into the string.
    expect(c).toContain('--setenv HTTPS_PROXY "$HTTPS_PROXY"');
    expect(c).not.toContain('http://proxy:8080');
  });

  test('single-quotes the original command as the final bash -lc arg', () => {
    const c = wrapBashCommand("echo 'hi there'", { roBinds: [] });
    expect(c.endsWith(`bash -lc 'echo '\\''hi there'\\'''`)).toBe(true);
  });
});
