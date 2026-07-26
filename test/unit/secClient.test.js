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

  it('passes non-SEC requests through without adding headers', async () => {
    let captured = null;
    const native = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => { captured = { input, init }; return { ok: true }; };
      installSecFetch(true);
      await globalThis.fetch('https://example.com/x');
      expect(captured.init?.headers).toBeUndefined();
    } finally {
      globalThis.fetch = native;
    }
  });

  it('does not overwrite a caller-provided User-Agent', async () => {
    let captured = null;
    const native = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => { captured = { input, init }; return { ok: true }; };
      installSecFetch(true);
      await globalThis.fetch('https://data.sec.gov/submissions/CIK0000320193.json', {
        headers: { 'User-Agent': 'custom-agent/9.9' },
      });
      expect(captured.init.headers.get('User-Agent')).toBe('custom-agent/9.9');
    } finally {
      globalThis.fetch = native;
    }
  });

  it('honors the SEC_USER_AGENT env override', async () => {
    let captured = null;
    const native = globalThis.fetch;
    process.env.SEC_USER_AGENT = 'override-ua/2.0';
    try {
      globalThis.fetch = async (input, init) => { captured = { input, init }; return { ok: true }; };
      installSecFetch(true);
      await globalThis.fetch('https://data.sec.gov/submissions/CIK0000320193.json');
      expect(captured.init.headers.get('User-Agent')).toBe('override-ua/2.0');
    } finally {
      globalThis.fetch = native;
      delete process.env.SEC_USER_AGENT;
    }
  });

  it('matches exact SEC hosts, not substrings', () => {
    expect(isSecUrl('https://sec.gov/x')).toBe(true);
    expect(isSecUrl('https://sec.gov.evil.com/x')).toBe(false);
  });
});
