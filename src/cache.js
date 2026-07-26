// SEC-only cache: in-memory Map for the current run, plus an optional on-disk
// JSON cache enabled with EDGAR_CACHE_DIR=./cache so repeat lookups don't re-hit
// SEC. Implements exactly the three functions the engine calls.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const TTL = { financials: DAY, companyDetails: DAY };
const memory = new Map();

// Read the env var at call time so the disk tier is testable and opt-in.
function cacheDir() {
  const dir = process.env.EDGAR_CACHE_DIR;
  if (!dir) return null;
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function diskPath(dir, key) {
  return join(dir, key.replace(/[^a-zA-Z0-9]/g, '_') + '.json');
}

export function cacheGet(key) {
  const mem = memory.get(key);
  if (mem && Date.now() < mem.expiresAt) return mem.data;

  const dir = cacheDir();
  if (dir) {
    try {
      const p = diskPath(dir, key);
      if (existsSync(p)) {
        const entry = JSON.parse(readFileSync(p, 'utf8'));
        if (Date.now() < entry.expiresAt) {
          memory.set(key, entry);
          return entry.data;
        }
      }
    } catch { /* corrupt/missing — ignore */ }
  }
  return null;
}

export async function cacheGetAsync(key) {
  return cacheGet(key);
}

export function cacheSet(key, data, category = 'financials') {
  const ttl = TTL[category] || TTL.financials;
  const entry = { data, expiresAt: Date.now() + ttl, fetchedAt: Date.now() };
  memory.set(key, entry);

  const dir = cacheDir();
  if (dir) {
    try { writeFileSync(diskPath(dir, key), JSON.stringify(entry)); } catch { /* ignore */ }
  }
}
