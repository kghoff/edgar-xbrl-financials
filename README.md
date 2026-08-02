# edgar-xbrl-financials

Turn a ticker into normalized financial statements — income statement, balance
sheet, and cash flow — straight from **SEC EDGAR XBRL filings**. Annual,
quarterly, and trailing-twelve-months, with a source tag or formula behind every
number. Zero runtime dependencies.

## Quickstart (60 seconds)

```bash
npx edgar-xbrl-financials AAPL
```

```
Apple Inc. (AAPL) · standard · FY2009–FY2025

INCOME STATEMENT ($M unless noted)
Field                                       2025          2024          2023 ...
Revenues                                 416,161       391,035       383,285
Gross Profit                             195,201       180,683       169,148
Net Income Loss                          112,010        93,736        96,995
...
```

### See where every number comes from

```bash
npx edgar-xbrl-financials AAPL --provenance
```

```
Revenues                                 416,161  ↳ RevenueFromContractWithCustomerExcludingAssessedTax [Layer 1]
Net Income Loss                          112,010  ↳ NetIncomeLoss [Layer 1]
Free Cash Flow                            98,767  ↳ operating_cash_flow - |capital_expenditures| [derived]
```

Other flags: `--quarterly` (recent quarters instead of years), `--json` (full
object — `npx edgar-xbrl-financials AAPL --json > aapl.json`).

## Use as a library

```js
import { getFinancials } from 'edgar-xbrl-financials';

const data = await getFinancials('AAPL');
data.years;                          // [2025, 2024, ...]  most recent first
data.annual.income[2025].revenues;   // 416161000000
data.provenance.income[2025].revenues; // { tag, layer, derived, confidence, formula }
data.industryType;                   // 'standard' | 'bank' | 'reit' | 'insurance'
```

Returned object: `{ ticker, companyName, industryType, years, annual, quarterly,
ttm, provenance }`. `annual`/`provenance` are keyed `[year][field]`; `quarterly`
is keyed `[fiscalYear][quarter]`. Field names are snake_case (`revenues`,
`net_income_loss`, `operating_cash_flow`, …).

## How it works

1. **Ticker → CIK** via SEC's company-tickers map.
2. **Company facts** pulled from SEC's XBRL `companyfacts` endpoint.
3. **A tag map (~200 XBRL tags)** maps each raw filing tag to a standardized
   field, with ordered fallbacks so different companies' tag choices normalize
   to the same line item.
4. **Industry overlays** add the tags that banks, REITs, and insurers report
   differently (detected by SIC code).
5. **Derived fields** (free cash flow, margins, TTM, …) are computed and carry a
   human-readable formula in `provenance`.

## Data source & caveats

- **SEC EDGAR only.** No paid providers, no scraping.
- **SEC requires a User-Agent.** A default is sent; override it with
  `SEC_USER_AGENT="you@example.com"` to identify yourself under SEC's
  fair-access policy (10 req/sec). **Do not put "github" in your User-Agent** —
  SEC's edge silently returns 403 for any User-Agent containing that substring
  (use an email or another contact URL instead).
- **Optional caching.** Set `EDGAR_CACHE_DIR=./cache` to persist SEC responses
  to disk between runs.
- **Per-share figures.** With no external split feed, per-share history (EPS,
  dividends-per-share) uses the issuer's own restated comparatives from recent
  filings — split-consistent within the restatement window. Every dollar total
  (revenue, net income, assets, debt, cash flow) is unaffected.

## Accuracy

The underlying tag map was validated against a 50-company Morningstar truth set
at **94.8%** field-level agreement (the truth-set data itself is licensed and is
not redistributed here).

## Acknowledgments

Built with [Claude Code](https://claude.com/claude-code) (Anthropic's Claude). This is
a human-directed, AI-assisted build — the architecture, methodology, and decisions are
mine; Claude did much of the implementation under that direction.

## License

MIT
