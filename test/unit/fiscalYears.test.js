import { describe, it, expect } from 'vitest';
import { annualByLabel, extractAnnualFact, fiscalProfile, labelForPeriod, quarterlyTagLabels } from '../../src/edgar.js';

const e = (fy, start, end, val, accn, filed, fp = 'FY') => ({ fy, fp, form: '10-K', start, end, val, accn, filed });

describe('fiscal-year labels', () => {
  it('recovers a year the SEC double-tagged (Kroger: years ending Feb 2025 and Jan 2026 are both fy 2025)', () => {
    const entries = [
      e(2022, '2022-01-30', '2023-01-28', 148.3, 'Z', '2023-04-01'),            // Kroger "fiscal 2022", tagged 2022
      e(2024, '2023-01-29', '2024-02-03', 150.0, 'A', '2024-04-02'),            // Kroger "fiscal 2023", tagged 2024
      e(2025, '2024-02-04', '2025-02-01', 147.1, 'B', '2025-04-01'),            // "fiscal 2024": own 10-K, tagged 2025
      e(2025, '2023-01-29', '2024-02-03', 150.0, 'B', '2025-04-01'),            //   its comparative
      e(2025, '2025-02-02', '2026-01-31', 147.6, 'C', '2026-04-01'),            // "fiscal 2025", tagged 2025 too
      e(2025, '2024-02-04', '2025-02-01', 147.2, 'C', '2026-04-01'),            //   restated comparative
    ];
    const got = annualByLabel(entries, false, { janFeb: true });                 // labels = end-date years
    expect(Object.keys(got).map(Number).sort()).toEqual([2023, 2024, 2025, 2026]);
    expect(got[2026].val).toBe(147.6);
    expect(got[2025].val).toBe(147.1);                                           // the filing's own value, not the restatement
    expect(got[2024].val).toBe(150.0);
    const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: entries } } } } };
    expect(fiscalProfile(facts)).toEqual({ janFeb: true, usualGap: 1, fyeMonth: 1 });
    expect(extractAnnualFact(facts, 'Revenues')).toEqual({ 2023: 148.3, 2024: 150.0, 2025: 147.1, 2026: 147.6 });
  });

  it('labels a December company by the SEC tag and still recovers a double-tagged year', () => {
    const entries = [
      e(2025, '2024-01-01', '2024-12-31', 10, 'A', '2025-02-20'),               // tagged 2025 by mistake
      e(2025, '2025-01-01', '2025-12-31', 12, 'B', '2026-02-20'),
      e(2025, '2024-01-01', '2024-12-31', 10.5, 'B', '2026-02-20'),             // restated comparative
    ];
    const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: entries } } } } };
    expect(fiscalProfile(facts)).toEqual({ janFeb: false, usualGap: 0, fyeMonth: 12 });
    expect(extractAnnualFact(facts, 'Revenues')).toEqual({ 2024: 10, 2025: 12 });
  });

  it('does not turn an ordinary comparative into an extra year', () => {
    const entries = [
      e(2024, '2023-01-01', '2023-12-31', 10, 'A', '2024-02-01'),
      e(2024, '2024-01-01', '2024-12-31', 12, 'A', '2024-02-01'),               // hmm: same filing, two years
      e(2025, '2024-01-01', '2024-12-31', 12, 'B', '2025-02-01'),               // comparative in the next 10-K
      e(2025, '2025-01-01', '2025-12-31', 14, 'B', '2025-02-01'),
    ];
    expect(Object.keys(annualByLabel(entries)).map(Number).sort()).toEqual([2024, 2025]);
    expect(annualByLabel(entries)[2024].val).toBe(12);
  });

  it('maps 10-Q fy tags to end-date labels from their own period ends, whichever way the tag runs', () => {
    const prof = { janFeb: true, usualGap: 1, fyeMonth: 1 };
    const q = (fy, fp, end) => ({ fy, fp, form: '10-Q', end, val: 1 });
    // Kroger tags fiscal 2026 (ends Jan 2027) as 2026 on its 10-Qs -> label 2027; Walmart tags the same period 2027
    const kr = { facts: { 'us-gaap': { Revenues: { units: { USD: [q(2025, 'Q3', '2025-11-08'), q(2026, 'Q1', '2026-05-23'),
                                                                     q(2026, 'Q2', '2026-08-15')] } } } } };
    expect(quarterlyTagLabels(kr, prof)).toEqual({ 2025: 2026, 2026: 2027 });
    const wmt = { facts: { 'us-gaap': { Revenues: { units: { USD: [q(2027, 'Q2', '2026-07-31')] } } } } };
    expect(quarterlyTagLabels(wmt, prof)).toEqual({ 2027: 2027 });
    expect(quarterlyTagLabels(wmt, { janFeb: false })).toEqual({});                 // other companies keep the tag
    expect(labelForPeriod('2026-01-31', 'FY', prof)).toBe(2026);                      // a 10-K ends at the year end
    expect(labelForPeriod('2026-08-15', 'Q2', prof)).toBe(2027);
  });
});
