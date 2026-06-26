import { describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BwrapJail } from '../src/index';

/** A fake opencode client whose session.get returns a fixed directory. */
const fakeClient = (directory: string) =>
  ({ session: { get: async () => ({ data: { directory } }) } }) as never;

describe('tool.execute.before', () => {
  test('creates the (missing) session cwd, then rewrites bash', async () => {
    const dir = join(tmpdir(), `oc-bwrap-${Date.now()}`); // does NOT exist yet
    const hooks = await BwrapJail({ client: fakeClient(dir) } as never);
    const output = { args: { command: 'pwd' } } as { args: { command: string } };

    await hooks['tool.execute.before']?.(
      { tool: 'bash', sessionID: 's1', callID: 'c1' } as never,
      output as never,
    );

    expect(existsSync(dir)).toBe(true); // the fix: the cwd now exists
    expect(output.args.command.startsWith('exec bwrap')).toBe(true);
    expect(output.args.command).toContain('--bind "$(pwd)" /workspace');
    rmSync(dir, { recursive: true, force: true });
  });

  test('leaves non-bash tools untouched', async () => {
    const hooks = await BwrapJail({ client: fakeClient('/whatever') } as never);
    const output = { args: { filePath: '/etc/passwd' } };
    await hooks['tool.execute.before']?.(
      { tool: 'read', sessionID: 's1', callID: 'c1' } as never,
      output as never,
    );
    expect(output.args).toEqual({ filePath: '/etc/passwd' });
  });
});
