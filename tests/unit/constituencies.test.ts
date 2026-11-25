import { describe, expect, it } from 'vitest';
import {
  NIGERIA_CONSTITUENCIES_DIRECTORY,
  TOTAL_FEDERAL_CONSTITUENCIES,
  TOTAL_SENATORIAL_DISTRICTS,
  getStateConstituencyProfile,
  lookupConstituency,
} from '../../src/data/constituenciesDirectory';

describe('Nigeria National Assembly Constituencies Directory', () => {
  it('contains all 36 States + FCT, 109 Senatorial Districts, and 360 Federal Constituencies', () => {
    expect(NIGERIA_CONSTITUENCIES_DIRECTORY).toHaveLength(37);
    expect(TOTAL_SENATORIAL_DISTRICTS).toBe(109);
    expect(TOTAL_FEDERAL_CONSTITUENCIES).toBe(360);
  });

  it('resolves FCT Abuja aliases cleanly', () => {
    const profile = getStateConstituencyProfile('FCT Abuja');
    expect(profile?.state).toBe('FCT');
    expect(profile?.senatorialDistricts).toEqual(['FCT Abuja']);
    expect(profile?.federalConstituencies).toHaveLength(2);
  });

  it('matches LGA / title hints to specific Federal Constituencies and Senatorial Districts', () => {
    const kadunaMatch = lookupConstituency('Kaduna State', 'Chikun', 'Solar Borehole in Chikun');
    expect(kadunaMatch.state).toBe('Kaduna');
    expect(kadunaMatch.matchedBy).toBe('lga_or_hint');
    expect(kadunaMatch.federalConstituency).toBe('Chikun / Kajuru');
    expect(kadunaMatch.totalFederalConstituenciesInState).toBe(16);

    const lagosMatch = lookupConstituency('Lagos', 'Ikorodu', 'General Hospital Ikorodu');
    expect(lagosMatch.federalConstituency).toBe('Ikorodu');
    expect(lagosMatch.geopoliticalZone).toBe('South West');
  });
});
