import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardPath, withinRoot } from '../src/pathGuard';

const root = mkdtempSync(join(tmpdir(), 'pg-'));
mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src', 'a.ts'), 'x');

describe('path-guard', () => {
  test('allows paths inside the root (absolute + relative)', () => {
    expect(() => guardPath('read', { filePath: join(root, 'src/a.ts') }, root)).not.toThrow();
    expect(() => guardPath('read', { filePath: 'src/a.ts' }, root)).not.toThrow();
    expect(withinRoot('src/a.ts', root)).toBe(true);
  });

  test('blocks /proc and /var/run/secrets and /etc (the secret-read vector)', () => {
    expect(() => guardPath('read', { filePath: '/proc/self/environ' }, root)).toThrow(/outside the workspace/);
    expect(() => guardPath('read', { filePath: '/var/run/secrets/x' }, root)).toThrow();
    expect(() => guardPath('read', { filePath: '/etc/passwd' }, root)).toThrow();
  });

  test('blocks ../ traversal out of the root', () => {
    expect(() => guardPath('read', { filePath: '../../etc/passwd' }, root)).toThrow();
  });

  test('blocks a symlink escape (realpath-resolved)', () => {
    const link = join(root, 'evil-link');
    symlinkSync('/etc/passwd', link);
    expect(() => guardPath('read', { filePath: link }, root)).toThrow();
  });

  test('allows writing a NEW file inside the root, blocks /etc write', () => {
    expect(() => guardPath('write', { filePath: join(root, 'new.txt'), content: 'y' }, root)).not.toThrow();
    expect(() => guardPath('write', { filePath: '/etc/evil', content: 'y' }, root)).toThrow();
    expect(() => guardPath('edit', { filePath: '/data/worktrees/tasks/other/x', oldString: 'a', newString: 'b' }, root)).toThrow();
  });

  test('grep/glob path is optional (absent → cwd, allowed) but a bad path is blocked', () => {
    expect(() => guardPath('grep', { pattern: 'x' }, root)).not.toThrow();
    expect(() => guardPath('grep', { pattern: 'x', path: '/proc' }, root)).toThrow();
    expect(() => guardPath('glob', { pattern: '**', path: '/etc' }, root)).toThrow();
  });

  test('non-file tools and unknown sessions are untouched', () => {
    expect(() => guardPath('webfetch', { url: 'http://x' }, root)).not.toThrow();
    expect(() => guardPath('read', { filePath: '/etc/passwd' }, undefined)).not.toThrow();
  });
});
