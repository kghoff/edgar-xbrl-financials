#!/usr/bin/env node
import { getFinancials } from '../src/index.js';

function parseArgs(argv) {
  const args = { ticker: null, quarterly: false, json: false, provenance: false };
  for (const a of argv) {
    if (a === '--quarterly') args.quarterly = true;
    else if (a === '--json') args.json = true;
    else if (a === '--provenance') args.provenance = true;
    else if (!a.startsWith('--') && !args.ticker) args.ticker = a;
  }
  return args;
}

function humanize(field) {
  return field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(field, val) {
  if (val == null) return '—';
  if (field.includes('per_share')) return val.toFixed(2);
  if (field.includes('shares')) return (val / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M';
  return (val / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

const LABEL_W = 34;
const COL_W = 14;

function fieldOrder(byCol, cols) {
  const seen = new Set();
  const order = [];
  for (const c of cols) {
    for (const f of Object.keys(byCol[c] || {})) {
      if (!seen.has(f)) { seen.add(f); order.push(f); }
    }
  }
  return order;
}

function printStatement(title, byCol, cols, colLabels, prov, showProv) {
  console.log(`\n${title} ($M unless noted)`);
  console.log('Field'.padEnd(LABEL_W) + colLabels.map((l) => String(l).padStart(COL_W)).join(''));
  for (const f of fieldOrder(byCol, cols)) {
    console.log(
      humanize(f).padEnd(LABEL_W) + cols.map((c) => fmt(f, byCol[c]?.[f]).padStart(COL_W)).join(''),
    );
    if (showProv && prov) {
      const p = prov[cols[0]]?.[f];
      if (p) {
        const src = p.derived ? `${p.formula} [derived]` : `${p.tag} [Layer ${p.layer}]`;
        console.log(' '.repeat(2) + `↳ ${src}`);
      }
    }
  }
}

// Flatten quarterly { fy: { qtr: {income,balance,cashFlow} } } into the most
// recent N quarter columns, newest first.
function recentQuarters(quarterly, n = 8) {
  const cols = [];
  const byCol = { income: {}, balance: {}, cashFlow: {} };
  const fys = Object.keys(quarterly).map(Number).sort((a, b) => b - a);
  for (const fy of fys) {
    for (const q of ['Q4', 'Q3', 'Q2', 'Q1']) {
      const cell = quarterly[fy]?.[q];
      if (!cell) continue;
      const key = `${fy}-${q}`;
      cols.push(key);
      byCol.income[key] = cell.income || {};
      byCol.balance[key] = cell.balance || {};
      byCol.cashFlow[key] = cell.cashFlow || {};
      if (cols.length >= n) return { cols, byCol };
    }
  }
  return { cols, byCol };
}

async function main() {
  const { ticker, quarterly, json, provenance } = parseArgs(process.argv.slice(2));
  if (!ticker) {
    console.error('Usage: edgar-xbrl-financials <TICKER> [--quarterly] [--json] [--provenance]');
    process.exit(1);
  }

  // The engine emits diagnostic progress via console.log; route those to stderr
  // during the fetch so stdout stays clean (important for `--json` piping).
  const originalLog = console.log;
  console.log = (...a) => console.error(...a);
  let data;
  try {
    data = await getFinancials(ticker);
  } finally {
    console.log = originalLog;
  }

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(
    `\n${data.companyName} (${data.ticker}) · ${data.industryType} · ` +
      `FY${data.years[data.years.length - 1]}–FY${data.years[0]}`,
  );

  if (quarterly) {
    if (!data.quarterly) { console.log('No quarterly data available.'); return; }
    const { cols, byCol } = recentQuarters(data.quarterly);
    printStatement('INCOME STATEMENT', byCol.income, cols, cols, null, false);
    printStatement('BALANCE SHEET', byCol.balance, cols, cols, null, false);
    printStatement('CASH FLOW', byCol.cashFlow, cols, cols, null, false);
    return;
  }

  const years = data.years;
  printStatement('INCOME STATEMENT', data.annual.income, years, years, data.provenance?.income, provenance);
  printStatement('BALANCE SHEET', data.annual.balance, years, years, data.provenance?.balance, provenance);
  printStatement('CASH FLOW', data.annual.cashFlow, years, years, data.provenance?.cashFlow, provenance);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
