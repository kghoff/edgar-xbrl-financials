import { describe, it, expect } from 'vitest';
import { classifyIndustryType } from '../../src/industryClassifier.js';
import { getOverlay } from '../../src/industryOverlays.js';
import { formatCompanyName } from '../../src/formatCompanyName.js';

describe('industry + name leaf files', () => {
  it('classifies SIC codes into industry types', () => {
    expect(classifyIndustryType('6022')).toBe('bank');       // state commercial bank
    expect(classifyIndustryType('6798')).toBe('reit');       // REIT
    expect(classifyIndustryType('6311')).toBe('insurance');  // life insurance
    expect(classifyIndustryType('3571')).toBe('standard');   // electronic computers
  });

  it('returns an overlay object for a special industry', () => {
    expect(getOverlay('bank')).toBeTruthy();
    expect(getOverlay('standard')).toBeFalsy();
  });

  it('formats a raw SEC company name', () => {
    expect(typeof formatCompanyName('APPLE INC')).toBe('string');
  });
});
