// edgar-xbrl-financials — public API.
// Importing secClient first installs the SEC User-Agent fetch interceptor
// before any engine module issues a request.
import './secClient.js';

import {
  fetchEdgarStatements,
  fetchEdgarQuarterly,
} from './edgarFinancials.js';
import { fetchCompanyInfo } from './edgar.js';

/**
 * Fetch normalized financial statements for a ticker, straight from SEC EDGAR.
 *
 * @param {string} ticker  e.g. "AAPL"
 * @param {object} [options]
 * @param {'restated'|'original'} [options.version='restated']
 * @returns {Promise<object>} { ticker, companyName, industryType, years, annual, quarterly, ttm, provenance }
 */
export async function getFinancials(ticker, options = {}) {
  const [statements, quarterly, info] = await Promise.all([
    fetchEdgarStatements(ticker, options),
    fetchEdgarQuarterly(ticker, options).catch(() => null),
    fetchCompanyInfo(ticker).catch(() => null),
  ]);

  if (!statements) {
    throw new Error(`No SEC financial data found for "${ticker}"`);
  }

  return {
    ticker: ticker.toUpperCase(),
    companyName: info?.name || ticker.toUpperCase(),
    industryType: statements.industryType,
    years: statements.years,
    annual: {
      income: statements.income,
      balance: statements.balance,
      cashFlow: statements.cashFlow,
    },
    quarterly: quarterly?.quarterly || null,
    ttm: statements.ttm,
    provenance: statements.provenance,
  };
}

// Re-export the raw engine functions for advanced users.
export { fetchEdgarStatements, fetchEdgarQuarterly } from './edgarFinancials.js';
export { fetchCompanyInfo, lookupCIK } from './edgar.js';
