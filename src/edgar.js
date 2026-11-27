// SEC EDGAR — financial data, company details, and ticker search.
// Free, no API key needed. SEC requires a User-Agent header, which is
// attached automatically by secClient.js. Rate limit: 10 requests/second.

import { cacheGet, cacheGetAsync, cacheSet } from './cache.js';
import { formatCompanyName } from './formatCompanyName.js';
import { secBase, edgarBase } from './secClient.js';

const FILINGS_CACHE_VERSION = 'v2';

// ─── SEC URL helpers ────────────────────────────────────────

// URLs point directly at SEC (via secClient's secBase/edgarBase).

function secTickerMapUrl() {
  return `${secBase()}/files/company_tickers.json`;
}

function secCompanyFactsUrl(cik) {
  return `${edgarBase()}/api/xbrl/companyfacts/CIK${cik}.json`;
}

function secSubmissionsUrl(cik) {
  return `${edgarBase()}/submissions/CIK${cik}.json`;
}

function secSubmissionFileUrl(name) {
  return `${edgarBase()}/submissions/${name}`;
}

// ─── CIK Lookup ──────────────────────────────────────────────

// Display name resolution: curated S&P 500 names → formatCompanyName() fallback
function displayName(ticker, rawSECName) {
  return formatCompanyName(rawSECName);
}

// Cache the full tickers map (loaded once, reused for all lookups)
let tickerMapPromise = null;
// Search index: array of { ticker, name, cik } for autocomplete
let tickerSearchIndex = null;

async function loadTickerMap() {
  const cacheKey = 'edgar:ticker-map';
  const cached = cacheGet(cacheKey);
  if (cached) {
    // Rebuild search index from cached map if needed
    if (!tickerSearchIndex) {
      tickerSearchIndex = Object.entries(cached.cikMap).map(([ticker, cik]) => ({
        ticker,
        name: displayName(ticker, cached.names?.[ticker]),
        cik,
      }));
    }
    return cached.cikMap;
  }

  const res = await fetch(secTickerMapUrl());
  if (!res.ok) throw new Error(`EDGAR ticker map: ${res.status}`);
  const data = await res.json();

  // Build ticker → CIK map + search index
  const cikMap = {};
  const names = {};
  tickerSearchIndex = [];
  for (const entry of Object.values(data)) {
    const ticker = entry.ticker.toUpperCase();
    const cik = String(entry.cik_str).padStart(10, '0');
    cikMap[ticker] = cik;
    names[ticker] = entry.title || '';
    tickerSearchIndex.push({ ticker, name: displayName(ticker, entry.title), cik });
  }

  cacheSet(cacheKey, { cikMap, names }, 'financials'); // 24hr cache
  return cikMap;
}

export async function lookupCIK(ticker) {
  // Don't cache a rejected promise — retry on next call if it failed
  if (!tickerMapPromise) {
    tickerMapPromise = loadTickerMap().catch(err => {
      tickerMapPromise = null; // allow retry
      throw err;
    });
  }
  const map = await tickerMapPromise;
  // SEC's ticker map uses hyphens for share classes (BRK-B, BF-A, MOG-A …);
  // 527 hyphenated tickers vs 0 with dots. Yahoo / brokerages display dots, so
  // accept either form: try as-typed first, then normalize "." → "-".
  const upper = ticker.toUpperCase();
  return map[upper] || map[upper.replace(/\./g, '-')] || null;
}

// ─── Ticker Search ─────────
// Searches the EDGAR ticker map locally by ticker prefix or company name substring.

// Expose the ticker search index for external use (e.g., CUSIP-to-ticker fuzzy matching)
export async function getTickerSearchIndex() {
  if (!tickerMapPromise) {
    tickerMapPromise = loadTickerMap().catch(err => {
      tickerMapPromise = null;
      throw err;
    });
  }
  await tickerMapPromise;
  return tickerSearchIndex || [];
}

export async function searchEdgarTickers(query, limit = 8) {
  if (!query || query.length < 1) return [];

  // Ensure ticker map is loaded
  if (!tickerMapPromise) {
    tickerMapPromise = loadTickerMap().catch(err => {
      tickerMapPromise = null;
      throw err;
    });
  }
  await tickerMapPromise;
  if (!tickerSearchIndex) return [];

  const q = query.toUpperCase().trim();

  // Score and filter
  const scored = [];
  for (const entry of tickerSearchIndex) {
    let score = 0;
    if (entry.ticker === q) score = 100;           // exact ticker match
    else if (entry.ticker.startsWith(q)) score = 50; // ticker prefix
    else if (entry.name.toUpperCase().includes(q)) score = 10; // name substring
    else continue;
    scored.push({ ...entry, score });
  }

  scored.sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
  return scored.slice(0, limit).map(({ ticker, name }) => ({ ticker, name }));
}

// ─── Company Info ─────────
// Fetches from EDGAR submissions endpoint: name, SIC, exchange, etc.

export async function fetchCompanyInfo(ticker) {
  const cik = await lookupCIK(ticker);
  if (!cik) return null;

  const cacheKey = `edgar:company:${cik}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = secSubmissionsUrl(cik);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`EDGAR submissions failed: ${res.status} for CIK ${cik}`);
    return null;
  }
  const data = await res.json();

  const info = {
    ticker: ticker.toUpperCase(),
    name: data.name ? formatCompanyName(data.name) : '',
    sic: data.sic || '',
    sicDescription: data.sicDescription || '',
    exchange: data.exchanges?.[0] || '',
    cik,
    stateOfIncorporation: data.stateOfIncorporation || '',
    fiscalYearEnd: data.fiscalYearEnd || '',
    phone: data.phone || '',
    website: data.website || '',
  };

  cacheSet(cacheKey, info, 'companyDetails');
  return info;
}

// ─── Filings List ───────────────────────────────────────────
// Fetches full list of SEC filings from the submissions endpoint.
// Returns array of { form, filingDate, reportDate, accessionNumber, primaryDocument, description, items, cik }

export async function fetchFilings(ticker) {
  const cik = await lookupCIK(ticker);
  if (!cik) return [];

  const cacheKey = `edgar:filings:${cik}:${FILINGS_CACHE_VERSION}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = secSubmissionsUrl(cik);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`EDGAR filings fetch failed: ${res.status} for CIK ${cik}`);
    return [];
  }
  const data = await res.json();

  const cleanCik = cik.replace(/^0+/, '');
  const filings = [];
  const seen = new Set();
  appendSubmissionFilings(filings, seen, data.filings?.recent, cleanCik);

  // SEC's `recent` block is capped. Active companies with heavy Form 4 volume
  // can have only ~3 annual reports there, with older 10-Ks stored in
  // `filings.files`. Pull just enough archive files to cover the research
  // pipeline's 5 annual / 4 quarterly target.
  const archiveFiles = data.filings?.files || [];
  for (const file of archiveFiles) {
    if (hasResearchFilingWindow(filings)) break;
    if (!file?.name) continue;
    const archiveRes = await fetch(secSubmissionFileUrl(file.name));
    if (!archiveRes.ok) {
      console.warn(`EDGAR filings archive fetch failed: ${archiveRes.status} for ${file.name}`);
      continue;
    }
    const archiveData = await archiveRes.json();
    appendSubmissionFilings(filings, seen, archiveData, cleanCik);
  }

  cacheSet(cacheKey, filings, 'companyDetails');
  return filings;
}

function appendSubmissionFilings(target, seen, recent, cleanCik) {
  if (!recent?.form) return;
  for (let i = 0; i < recent.form.length; i++) {
    const accessionNumber = recent.accessionNumber?.[i];
    if (!accessionNumber || seen.has(accessionNumber)) continue;
    seen.add(accessionNumber);
    target.push({
      form: recent.form[i],
      filingDate: recent.filingDate?.[i] || '',
      reportDate: recent.reportDate?.[i] || '',
      accessionNumber,
      primaryDocument: recent.primaryDocument?.[i] || '',
      description: recent.primaryDocDescription?.[i] || '',
      items: recent.items?.[i] || '',
      cik: cleanCik,
    });
  }
}

function hasResearchFilingWindow(filings) {
  let tenKs = 0;
  let tenQs = 0;
  for (const filing of filings) {
    if (filing.form === '10-K' && !filing.primaryDocument?.endsWith('.xml')) tenKs++;
    if (filing.form === '10-Q' && !filing.primaryDocument?.endsWith('.xml')) tenQs++;
  }
  return tenKs >= 5 && tenQs >= 4;
}

// ─── Company Facts ───────────────────────────────────────────

export async function fetchCompanyFacts(cik) {
  const cacheKey = `edgar:facts:${cik}`;
  const cached = await cacheGetAsync(cacheKey);
  if (cached) return cached;

  const url = secCompanyFactsUrl(cik);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`EDGAR company facts failed: ${res.status} for CIK ${cik} (${url})`);
    return null;
  }
  const data = await res.json();

  cacheSet(cacheKey, data, 'financials');
  return data;
}

// ─── XBRL Fact Extraction ────────────────────────────────────

// ── Fiscal-year labels ───────────────────────────────────────
// Each 10-K carries the SEC's fiscal-year tag (fy) on its current year AND its prior-year comparatives, so a
// filing's current year is the entry with the latest period end inside its fy group (fp=FY preferred over Q4;
// ties on end go to the latest filing, or the earliest with originalFirst).
// Two SEC quirks are handled here:
// 1. The SEC sometimes tags two consecutive 10-Ks with the same fy (Kroger's years ending Feb 2025 and Jan 2026
//    are both fy=2025; Albertsons likewise). Grouping by fy alone silently dropped the earlier year. A filing whose
//    own current period (its latest end, by accession number) ends before the group's latest end is such a
//    double-tagged earlier 10-K, and its period becomes a year of its own.
// 2. For companies whose fiscal years end in January or February, the fy tag is the start year for some (Kroger,
//    BJ's: fy=2025 ends Jan 2026) and the end year for others (Walmart: fy=2026 ends Jan 2026). Morningstar and
//    Rule One label such years by the calendar year of the period end, so these companies' years are labelled by
//    end date (fiscalProfile decides, once per company facts object). Other companies keep the fy tag, which is the
//    calendar year; a recovered double-tagged year takes tag - (years back) when that label is free.
const FYE_CANDIDATES = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Assets', 'NetIncomeLoss', 'SalesRevenueNet'];
const PROFILES = new WeakMap();

function annualEntries(companyFacts, tag, unit = 'USD') {
  const entries = companyFacts?.facts?.['us-gaap']?.[tag]?.units?.[unit] || [];
  // Include fp=Q4 from 10-K filings as fallback — some companies tag annual
  // data as Q4 instead of FY (e.g., COST FY2019 has 599 Q4 entries, zero FY).
  return entries.filter(e => e.form === '10-K' && (e.fp === 'FY' || e.fp === 'Q4'));
}

function latestEndByTag(annual) {
  const out = {};
  for (const e of annual) if (e.fy && e.end && (!out[e.fy] || e.end > out[e.fy])) out[e.fy] = e.end;
  return out;
}

// { janFeb, usualGap }: whether this company's years are labelled by end date, and its usual gap between the
// SEC tag and the end year (0 for Walmart, 1 for Kroger) for years with no 10-K yet.
export function fiscalProfile(companyFacts) {
  if (!companyFacts || typeof companyFacts !== 'object') return { janFeb: false, usualGap: 0, fyeMonth: 12 };
  if (PROFILES.has(companyFacts)) return PROFILES.get(companyFacts);
  let prof = { janFeb: false, usualGap: 0, fyeMonth: 12 };
  for (const tag of FYE_CANDIDATES) {
    const byTag = latestEndByTag(annualEntries(companyFacts, tag));
    const tags = Object.keys(byTag).map(Number).sort((a, b) => a - b);
    if (!tags.length) continue;
    const month = Number(byTag[tags[0]].slice(5, 7));
    const counts = {};
    for (const t of tags) { const g = Number(byTag[t].slice(0, 4)) - t; counts[g] = (counts[g] || 0) + 1; }
    const usualGap = Number(Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0]);
    prof = { janFeb: month === 1 || month === 2, usualGap, fyeMonth: month };
    break;
  }
  PROFILES.set(companyFacts, prof);
  return prof;
}

// A tag's annual entries -> { [label]: entry } (see above).
export function annualByLabel(annual, originalFirst = false, profile = { janFeb: false }) {
  const better = (e, cur) => !cur
    || (e.fp === 'FY' && cur.fp !== 'FY')
    || (e.fp === cur.fp && (e.end > cur.end
      || (e.end === cur.end && (originalFirst ? e.filed < cur.filed : e.filed > cur.filed))));
  const byFY = {};
  for (const e of annual) {
    if (!e.fy) continue;
    (byFY[e.fy] ||= []).push(e);
  }
  const mains = [], spills = [];
  for (const [fyStr, es] of Object.entries(byFY)) {
    const fy = Number(fyStr);
    let main = null;
    for (const e of es) if (better(e, main)) main = e;
    mains.push({ fy, entry: main });
    const currentEnd = {};                                   // accession -> that filing's own latest end
    for (const e of es) if (e.accn && (!currentEnd[e.accn] || e.end > currentEnd[e.accn])) currentEnd[e.accn] = e.end;
    for (const end of new Set(Object.values(currentEnd).filter((x) => x < main.end))) {
      const yearsBack = Math.round((new Date(main.end) - new Date(end)) / (365.25 * 86400000));
      if (yearsBack < 1) continue;
      const own = new Set(Object.keys(currentEnd).filter((a) => currentEnd[a] === end));
      let pick = null;                                       // that filing's own value first, then any for the period
      for (const e of es) if (e.end === end && own.has(e.accn) && better(e, pick)) pick = e;
      for (const e of es) if (e.end === end && !pick) pick = e;
      spills.push({ fy: fy - yearsBack, entry: pick });
    }
  }
  const label = (x) => (profile.janFeb && x.entry.end ? Number(x.entry.end.slice(0, 4)) : x.fy);
  const out = {};
  for (const x of mains) if (!(label(x) in out)) out[label(x)] = x.entry;
  for (const x of spills) if (!(label(x) in out)) out[label(x)] = x.entry;
  return out;
}

// Extract annual values for a given XBRL tag from company facts.
// Returns { [year]: value } where year = the SEC fiscal-year tag (annualByLabel above).
// unit: 'USD' (default), 'USD/shares' (EPS, DPS), or 'shares' (share counts)
export function extractAnnualFact(companyFacts, tag, unit = 'USD') {
  const annual = annualEntries(companyFacts, tag, unit);
  if (annual.length === 0) return null;

  const result = {};
  for (const [fy, entry] of Object.entries(annualByLabel(annual, false, fiscalProfile(companyFacts)))) {
    result[Number(fy)] = entry.val;
  }
  return result;
}

// Same as extractAnnualFact but prefers the EARLIEST filing for each fiscal year.
// Returns the as-originally-reported values, not restated comparatives from later
// filings. Used for per-share and share count fields: post-split filings restate
// 2-3 years of comparatives with split-adjusted numbers, which would cause
// double-adjustment if we applied our own split factors on top.
export function extractAnnualFactOriginal(companyFacts, tag, unit = 'USD') {
  const annual = annualEntries(companyFacts, tag, unit);
  if (annual.length === 0) return null;

  const result = {};
  for (const [fy, entry] of Object.entries(annualByLabel(annual, true, fiscalProfile(companyFacts)))) {
    result[Number(fy)] = entry.val;
  }
  return result;
}

// Fiscal year end dates per year label (the labels the statements use), from a common tag's 10-K entries.
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function extractFiscalYearEndDates(companyFacts) {
  for (const tag of FYE_CANDIDATES) {
    const annual = annualEntries(companyFacts, tag).filter(e => e.fy && e.end);
    if (annual.length === 0) continue;
    const result = {};
    for (const [fy, entry] of Object.entries(annualByLabel(annual, false, fiscalProfile(companyFacts)))) {
      result[Number(fy)] = entry.end;
    }
    return result;
  }
  return {};
}

// Extract fiscal year end months from company facts.
// Returns { [year]: 'Sep' } by looking at a common tag's 10-K end dates.
export function extractFiscalYearEnds(companyFacts) {
  const result = {};
  for (const [fy, end] of Object.entries(extractFiscalYearEndDates(companyFacts))) {
    result[Number(fy)] = MONTH_ABBR[parseInt(end.split('-')[1]) - 1];
  }
  return result;
}

// The year label of a period for a January / February company: the calendar year in which its fiscal year ends.
// A 10-K period ends at the fiscal year end; a 10-Q period ending after the fiscal-year-end month belongs to the
// fiscal year that ends next year.
export function labelForPeriod(end, fp, profile) {
  const y = Number(end.slice(0, 4));
  if (!profile.janFeb || fp === 'FY') return y;
  return Number(end.slice(5, 7)) > profile.fyeMonth ? y + 1 : y;
}

// Quarterly data is keyed by the SEC fy TAG of the 10-Qs (the issuer's own fiscal-year label, which runs either
// way: Kroger's fiscal 2026 ends Jan 2027, Walmart's fiscal 2027 ends Jan 2027). For a January / February company,
// map each tag to the label the annual statements use, from the tag's own 10-Q period ends. Other companies keep
// the tag. Returns { [tag]: label }.
export function quarterlyTagLabels(companyFacts, profile) {
  const out = {};
  if (!profile.janFeb) return out;
  const latest = {};
  for (const tag of FYE_CANDIDATES) {
    for (const entries of Object.values(companyFacts?.facts?.['us-gaap']?.[tag]?.units || {})) {
      for (const e of entries) {
        if (e.form === '10-Q' && e.fy && e.end && ['Q1', 'Q2', 'Q3'].includes(e.fp)
            && (!latest[e.fy] || e.end > latest[e.fy])) latest[e.fy] = e.end;
      }
    }
    if (Object.keys(latest).length) break;
  }
  for (const [fy, end] of Object.entries(latest)) out[Number(fy)] = labelForPeriod(end, 'Q', profile);
  return out;
}

// Find the most recent 10-Q filing quarter from company facts.
// Returns { fy, fp, end } or null if no quarterly data exists.
export function findLatestQuarter(companyFacts) {
  const candidates = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Assets', 'NetIncomeLoss', 'SalesRevenueNet'];

  let latestQEnd = '';
  let latestQInfo = null;
  let latestKEnd = '';
  let latestKInfo = null;

  for (const tag of candidates) {
    const facts = companyFacts?.facts?.['us-gaap']?.[tag];
    if (!facts) continue;
    for (const entries of Object.values(facts.units || {})) {
      for (const e of entries) {
        if (e.form === '10-Q' && ['Q1', 'Q2', 'Q3'].includes(e.fp) && e.end > latestQEnd) {
          latestQEnd = e.end;
          latestQInfo = { fy: e.fy, fp: e.fp, end: e.end };
        }
        if (e.form === '10-K' && e.fp === 'FY' && e.end > latestKEnd) {
          latestKEnd = e.end;
          latestKInfo = { fy: e.fy, fp: 'FY', end: e.end };
        }
      }
    }
  }

  // If the latest 10-K covers a later period than the latest 10-Q, use it.
  // This handles Q4: after the annual 10-K is filed but before Q1 of the next FY.
  if (latestKInfo && (!latestQInfo || latestKInfo.end > latestQInfo.end)) {
    return latestKInfo;
  }
  return latestQInfo;
}

// Try multiple XBRL tags in priority order (companies use different tags)
export function extractAnnualFactMulti(companyFacts, tags, unit = 'USD') {
  for (const tag of tags) {
    const result = extractAnnualFact(companyFacts, tag, unit);
    if (result && Object.keys(result).length > 0) return { data: result, tag };
  }
  return { data: null, tag: null };
}

// ─── Public API ──────────────────────────────────────────────

// Fetch CapEx (Purchase of PP&E) — the standard Rule One definition
// Returns { [year]: value } in raw dollars (positive number = cash spent)
export async function fetchCapEx(ticker) {
  const cik = await lookupCIK(ticker);
  if (!cik) return {};

  const facts = await fetchCompanyFacts(cik);
  if (!facts) return {};

  const { data } = extractAnnualFactMulti(facts, [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
    'CapitalExpendituresIncurredButNotYetPaid', // rare fallback
  ]);

  return data || {};
}

// Fetch Depreciation & Amortization
export async function fetchDepreciation(ticker) {
  const cik = await lookupCIK(ticker);
  if (!cik) return {};

  const facts = await fetchCompanyFacts(cik);
  if (!facts) return {};

  const { data } = extractAnnualFactMulti(facts, [
    'DepreciationDepletionAndAmortization',
    'DepreciationAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
    'Depreciation',
  ]);

  return data || {};
}

// Fetch Cash & Cash Equivalents (for net debt calculation)
export async function fetchCash(ticker) {
  const cik = await lookupCIK(ticker);
  if (!cik) return {};

  const facts = await fetchCompanyFacts(cik);
  if (!facts) return {};

  const { data } = extractAnnualFactMulti(facts, [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsAndShortTermInvestments',
    'Cash',
  ]);

  return data || {};
}

// Fetch multiple EDGAR facts at once (single CIK lookup + company facts fetch)
// Returns { capEx, depreciation, cash, dividendsPerShare }
export async function fetchEdgarFinancials(ticker) {
  const cik = await lookupCIK(ticker);
  if (!cik) {
    console.warn(`EDGAR: CIK not found for ticker "${ticker}"`);
    return { capEx: {}, depreciation: {}, cash: {}, dividendsPerShare: {} };
  }

  const facts = await fetchCompanyFacts(cik);
  if (!facts) {
    console.warn(`EDGAR: Company facts not available for CIK ${cik} (${ticker})`);
    return { capEx: {}, depreciation: {}, cash: {}, dividendsPerShare: {} };
  }

  const capExResult = extractAnnualFactMulti(facts, [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
  ]);
  const capEx = capExResult.data || {};

  const depreciation = extractAnnualFactMulti(facts, [
    'DepreciationDepletionAndAmortization',
    'DepreciationAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
  ]).data || {};

  const cash = extractAnnualFactMulti(facts, [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsAndShortTermInvestments',
  ]).data || {};

  const dividendsPerShare = extractAnnualFactMulti(facts, [
    'CommonStockDividendsPerShareDeclared',
    'CommonStockDividendsPerShareCashPaid',
  ], 'USD/shares').data || {};

  const retainedEarnings = extractAnnualFactMulti(facts, [
    'RetainedEarningsAccumulatedDeficit',
    'RetainedEarningsUnappropriated',
  ]).data || {};

  console.log(`EDGAR ${ticker}: CIK=${cik}, capEx tag=${capExResult.tag}, years=${Object.keys(capEx).join(',')}`);

  return { capEx, depreciation, cash, dividendsPerShare, retainedEarnings };
}

// Test exports
export const _testExports = { displayName };
