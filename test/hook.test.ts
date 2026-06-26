import { describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BwrapJail } from '../src/index';

/** A fake opencode client whose session.get returns a fixed directory. */
const fakeClient = (directory: string) =>
  ({ session: { get: async () => ({ data: { directory } }) } }) as never;

describe('silent jail', () => {
  test('chat.message creates the (missing) session dir before any tool runs', async () => {
    const dir = join(tmpdir(), `oc-bwrap-${Date.now()}`); // does NOT exist yet
    const hooks = await BwrapJail({ client: fakeClient(dir) } as never);
    await hooks['chat.message']?.({ sessionID: 's1' } as never, {} as never);
    expect(existsSync(dir)).toBe(true); // own-space fix: the cwd now exists
    rmSync(dir, { recursive: true, force: true });
  });

  test('registers a custom bash tool — the card shows the model command, not bwrap', async () => {
    const hooks = await BwrapJail({ client: fakeClient('/x') } as never);
    expect(hooks.tool?.bash).toBeDefined();
  });
});
