import { describe, it, expect } from 'vitest';
import { getFinancials } from '../../src/index.js';

describe('industry overlays (live SEC)', () => {
  it('JPM classifies as a bank', async () => {
    const data = await getFinancials('JPM');
    expect(data.industryType).toBe('bank');
    expect(data.years.length).toBeGreaterThan(3);
    // company name is formatted, not raw SEC ALL-CAPS
    expect(/[a-z]/.test(data.companyName)).toBe(true);
    expect(data.companyName).not.toBe(data.companyName.toUpperCase());
  });

  it('O (Realty Income) classifies as a REIT', async () => {
    const data = await getFinancials('O');
    expect(data.industryType).toBe('reit');
  });

  it('PGR (Progressive) classifies as insurance', async () => {
    const data = await getFinancials('PGR');
    expect(data.industryType).toBe('insurance');
  });
});
