import { describe, it, expect } from 'vitest';
import { getFinancials } from '../../src/index.js';

describe('getFinancials (live SEC)', () => {
  it('returns normalized annual statements + provenance for AAPL', async () => {
    const data = await getFinancials('AAPL');
    expect(data.ticker).toBe('AAPL');
    expect(data.industryType).toBe('standard');
    expect(Array.isArray(data.years)).toBe(true);
    expect(data.years.length).toBeGreaterThan(3);

    const latest = data.years[0];
    // revenue is present and a positive number in the latest fiscal year
    // (engine field is "revenues", plural — see INCOME_TAXONOMY in edgarFinancials.js)
    expect(typeof data.annual.income[latest].revenues).toBe('number');
    expect(data.annual.income[latest].revenues).toBeGreaterThan(0);

    // provenance carries a source tag for revenue
    expect(data.provenance.income[latest].revenues).toBeTruthy();

    // TTM exists
    expect(data.ttm).toBeTruthy();
  });
});
