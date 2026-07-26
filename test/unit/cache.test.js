import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheGet, cacheGetAsync, cacheSet } from '../../src/cache.js';

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
});
