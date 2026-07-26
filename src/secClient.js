// Direct SEC access for Node. Replaces the browser apiBase proxy.
//
// In the browser, SEC calls were proxied through a Cloudflare Worker because
// browsers can't set User-Agent and hit CORS. In Node neither problem exists:
// we call SEC directly and attach the required User-Agent via a fetch
// interceptor, so the copied engine files keep their bare fetch(url) calls.

function userAgent() {
  return process.env.SEC_USER_AGENT
    || 'edgar-xbrl-financials/1.0 (+https://github.com/kghoff/edgar-xbrl-financials)';
}

const SEC_HOSTS = new Set(['www.sec.gov', 'data.sec.gov', 'sec.gov']);

export function isSecUrl(url) {
  try { return SEC_HOSTS.has(new URL(url).host); } catch { return false; }
}

export function secBase() { return 'https://www.sec.gov'; }
export function edgarBase() { return 'https://data.sec.gov'; }

let installed = false;

// `force` re-wraps even if already installed (used by tests).
export function installSecFetch(force = false) {
  if (installed && !force) return;
  installed = true;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url || '');
    if (isSecUrl(url)) {
      const headers = new Headers(init.headers || {});
      if (!headers.has('User-Agent')) headers.set('User-Agent', userAgent());
      return nativeFetch(input, { ...init, headers });
    }
    return nativeFetch(input, init);
  };
}

// Install on import so any consumer of the engine gets SEC-authorized fetch.
installSecFetch();
