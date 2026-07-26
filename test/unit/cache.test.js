import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheGet, cacheGetAsync, cacheSet } from '../../src/cache.js';

// Mirrors the module's exact on-disk filename scheme so tests can write
// cache files directly without ever warming the in-memory Map.
function diskPath(dir, key) {
  return join(dir, key.replace(/[^a-zA-Z0-9]/g, '_') + '.json');
}

describe('cache', () => {
  beforeEach(() => { delete process.env.EDGAR_CACHE_DIR; });

  it('returns null for a missing key', () => {
    expect(cacheGet('edgar:facts:nope')).toBeNull();
  });

  it('round-trips a value through memory', async () => {
    cacheSet('k1', { a: 1 }, 'financials');
    expect(cacheGet('k1')).toEqual({ a: 1 });
    expect(await cacheGetAsync('k1')).toEqual({ a: 1 });
  });

  it('persists to disk when EDGAR_CACHE_DIR is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edgar-cache-'));
    process.env.EDGAR_CACHE_DIR = dir;
    cacheSet('edgar:facts:0000320193', { facts: true }, 'financials');
    expect(readdirSync(dir).length).toBe(1);
    expect(existsSync(dir)).toBe(true);
    expect(cacheGet('edgar:facts:0000320193')).toEqual({ facts: true });
  });

  it('reads a fresh entry written directly to disk (cold memory)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edgar-cache-'));
    const key = 'edgar:facts:disk-read-fresh';
    const entry = { data: { fromDisk: true }, expiresAt: Date.now() + 60000, fetchedAt: Date.now() };
    writeFileSync(diskPath(dir, key), JSON.stringify(entry));
    process.env.EDGAR_CACHE_DIR = dir;
    // key was never passed to cacheSet in this process, so memory is cold
    // and this can only succeed via the disk-read branch.
    expect(cacheGet(key)).toEqual({ fromDisk: true });
  });

  it('returns null for an expired entry written directly to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edgar-cache-'));
    const key = 'edgar:facts:disk-read-expired';
    const entry = { data: { fromDisk: true }, expiresAt: Date.now() - 1000, fetchedAt: Date.now() };
    writeFileSync(diskPath(dir, key), JSON.stringify(entry));
    process.env.EDGAR_CACHE_DIR = dir;
    expect(cacheGet(key)).toBeNull();
  });

  it('fails soft to null for a corrupt disk file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edgar-cache-'));
    const key = 'edgar:facts:disk-read-corrupt';
    writeFileSync(diskPath(dir, key), 'not json {{{');
    process.env.EDGAR_CACHE_DIR = dir;
    expect(() => cacheGet(key)).not.toThrow();
    expect(cacheGet(key)).toBeNull();
  });
});
