import { describe, it, expect } from 'vitest';
import { secBase, edgarBase, isSecUrl, installSecFetch } from '../../src/secClient.js';

describe('secClient', () => {
  it('points at the real SEC hosts', () => {
    expect(secBase()).toBe('https://www.sec.gov');
    expect(edgarBase()).toBe('https://data.sec.gov');
  });

  it('recognizes SEC URLs', () => {
    expect(isSecUrl('https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json')).toBe(true);
    expect(isSecUrl('https://www.sec.gov/files/company_tickers.json')).toBe(true);
    expect(isSecUrl('https://example.com/x')).toBe(false);
    expect(isSecUrl('not a url')).toBe(false);
  });

  it('installs a fetch interceptor that adds a User-Agent for SEC hosts', async () => {
    let captured = null;
    const native = globalThis.fetch;
    // Simulate: replace native, re-install, verify header injection, restore.
    globalThis.fetch = async (input, init) => { captured = { input, init }; return { ok: true }; };
    installSecFetch(true); // re-wrap the stubbed fetch
    await globalThis.fetch('https://data.sec.gov/submissions/CIK0000320193.json');
    const ua = captured.init.headers.get('User-Agent');
    expect(ua).toContain('edgar-xbrl-financials');
    globalThis.fetch = native;
  });
});
