import { SeasonType, SexType, BenchmarkPoint } from '../types';

/**
 * Winter Brood / Grow (Aug - Jan), Summer Laying (Feb - Jul):
 * Reproducing exact Suguna Foods standard benchmarks for Weeks 1 to 23
 */
export const WINTER_BROOD_STANDARDS = [
  { week: 1,  femaleWeight: 140,  femaleGain: 100, femaleFeed: 23,  maleWeight: 140,  maleGain: 100, maleFeed: 23 },
  { week: 2,  femaleWeight: 260,  femaleGain: 120, femaleFeed: 29,  maleWeight: 320,  maleGain: 180, maleFeed: 32 },
  { week: 3,  femaleWeight: 400,  femaleGain: 140, femaleFeed: 35,  maleWeight: 510,  maleGain: 190, maleFeed: 43 },
  { week: 4,  femaleWeight: 520,  femaleGain: 120, femaleFeed: 40,  maleWeight: 690,  maleGain: 180, maleFeed: 51 },
  { week: 5,  femaleWeight: 630,  femaleGain: 110, femaleFeed: 44,  maleWeight: 850,  maleGain: 160, maleFeed: 58 },
  { week: 6,  femaleWeight: 730,  femaleGain: 100, femaleFeed: 46,  maleWeight: 1000, maleGain: 150, maleFeed: 63 },
  { week: 7,  femaleWeight: 830,  femaleGain: 100, femaleFeed: 48,  maleWeight: 1140, maleGain: 140, maleFeed: 67 },
  { week: 8,  femaleWeight: 920,  femaleGain: 90,  femaleFeed: 50,  maleWeight: 1270, maleGain: 130, maleFeed: 70 },
  { week: 9,  femaleWeight: 1010, femaleGain: 90,  femaleFeed: 52,  maleWeight: 1400, maleGain: 130, maleFeed: 72 },
  { week: 10, femaleWeight: 1100, femaleGain: 90,  femaleFeed: 53,  maleWeight: 1530, maleGain: 130, maleFeed: 74 },
  { week: 11, femaleWeight: 1180, femaleGain: 80,  femaleFeed: 54,  maleWeight: 1650, maleGain: 120, maleFeed: 76 },
  { week: 12, femaleWeight: 1260, femaleGain: 80,  femaleFeed: 55,  maleWeight: 1770, maleGain: 120, maleFeed: 77 },
  { week: 13, femaleWeight: 1340, femaleGain: 80,  femaleFeed: 57,  maleWeight: 1880, maleGain: 110, maleFeed: 78 },
  { week: 14, femaleWeight: 1430, femaleGain: 90,  femaleFeed: 60,  maleWeight: 1990, maleGain: 110, maleFeed: 79 },
  { week: 15, femaleWeight: 1530, femaleGain: 100, femaleFeed: 65,  maleWeight: 2110, maleGain: 120, maleFeed: 83 },
  { week: 16, femaleWeight: 1640, femaleGain: 110, femaleFeed: 70,  maleWeight: 2240, maleGain: 130, maleFeed: 87 },
  { week: 17, femaleWeight: 1765, femaleGain: 125, femaleFeed: 77,  maleWeight: 2390, maleGain: 150, maleFeed: 94 },
  { week: 18, femaleWeight: 1905, femaleGain: 140, femaleFeed: 85,  maleWeight: 2550, maleGain: 160, maleFeed: 101 },
  { week: 19, femaleWeight: 2065, femaleGain: 160, femaleFeed: 92,  maleWeight: 2720, maleGain: 170, maleFeed: 106 },
  { week: 20, femaleWeight: 2235, femaleGain: 170, femaleFeed: 98,  maleWeight: 2890, maleGain: 170, maleFeed: 109 },
  { week: 21, femaleWeight: 2415, femaleGain: 180, femaleFeed: 102, maleWeight: 3050, maleGain: 160, maleFeed: 112 },
  { week: 22, femaleWeight: 2585, femaleGain: 170, femaleFeed: 105, maleWeight: 3200, maleGain: 150, maleFeed: 114 },
  { week: 23, femaleWeight: 2745, femaleGain: 160, femaleFeed: 108, maleWeight: 3340, maleGain: 140, maleFeed: 117 }
];

/**
 * Summer Brood / Grow (Feb - Jul), Winter Laying (Aug - Jan):
 * Reproducing exact Suguna Foods standard benchmarks for Weeks 1 to 23
 */
export const SUMMER_BROOD_STANDARDS = [
  { week: 1,  femaleWeight: 140,  femaleGain: 100, femaleFeed: 23,  maleWeight: 140,  maleGain: 100, maleFeed: 23 },
  { week: 2,  femaleWeight: 260,  femaleGain: 120, femaleFeed: 29,  maleWeight: 320,  maleGain: 180, maleFeed: 32 },
  { week: 3,  femaleWeight: 400,  femaleGain: 140, femaleFeed: 35,  maleWeight: 510,  maleGain: 190, maleFeed: 43 },
  { week: 4,  femaleWeight: 530,  femaleGain: 130, femaleFeed: 40,  maleWeight: 690,  maleGain: 180, maleFeed: 51 },
  { week: 5,  femaleWeight: 640,  femaleGain: 110, femaleFeed: 44,  maleWeight: 850,  maleGain: 160, maleFeed: 58 },
  { week: 6,  femaleWeight: 740,  femaleGain: 100, femaleFeed: 47,  maleWeight: 1000, maleGain: 150, maleFeed: 63 },
  { week: 7,  femaleWeight: 840,  femaleGain: 100, femaleFeed: 49,  maleWeight: 1140, maleGain: 140, maleFeed: 67 },
  { week: 8,  femaleWeight: 940,  femaleGain: 100, femaleFeed: 51,  maleWeight: 1270, maleGain: 130, maleFeed: 70 },
  { week: 9,  femaleWeight: 1040, femaleGain: 100, femaleFeed: 52,  maleWeight: 1400, maleGain: 130, maleFeed: 72 },
  { week: 10, femaleWeight: 1130, femaleGain: 90,  femaleFeed: 53,  maleWeight: 1530, maleGain: 130, feed: 74, maleFeed: 74 },
  { week: 11, femaleWeight: 1220, femaleGain: 90,  femaleFeed: 54,  maleWeight: 1650, maleGain: 120, maleFeed: 76 },
  { week: 12, femaleWeight: 1310, femaleGain: 90,  femaleFeed: 56,  maleWeight: 1770, maleGain: 120, maleFeed: 77 },
  { week: 13, femaleWeight: 1400, femaleGain: 90,  femaleFeed: 58,  maleWeight: 1880, maleGain: 110, maleFeed: 78 },
  { week: 14, femaleWeight: 1500, femaleGain: 100, femaleFeed: 61,  maleWeight: 1990, maleGain: 110, maleFeed: 79 },
  { week: 15, femaleWeight: 1610, femaleGain: 110, femaleFeed: 66,  maleWeight: 2110, maleGain: 120, maleFeed: 83 },
  { week: 16, femaleWeight: 1730, femaleGain: 120, femaleFeed: 72,  maleWeight: 2240, maleGain: 130, maleFeed: 87 },
  { week: 17, femaleWeight: 1865, femaleGain: 135, femaleFeed: 80,  maleWeight: 2390, maleGain: 150, maleFeed: 94 },
  { week: 18, femaleWeight: 2020, femaleGain: 155, femaleFeed: 88,  maleWeight: 2550, maleGain: 160, maleFeed: 101 },
  { week: 19, femaleWeight: 2190, femaleGain: 170, femaleFeed: 95,  maleWeight: 2720, maleGain: 170, maleFeed: 106 },
  { week: 20, femaleWeight: 2370, femaleGain: 180, femaleFeed: 102, maleWeight: 2890, maleGain: 170, maleFeed: 109 },
  { week: 21, femaleWeight: 2550, femaleGain: 180, femaleFeed: 107, maleWeight: 3050, maleGain: 160, maleFeed: 112 },
  { week: 22, femaleWeight: 2720, femaleGain: 170, femaleFeed: 110, maleWeight: 3200, maleGain: 150, maleFeed: 114 },
  { week: 23, femaleWeight: 2880, femaleGain: 160, femaleFeed: 113, maleWeight: 3340, maleGain: 140, maleFeed: 117 }
];

export function normalizeClientSeason(season: string): SeasonType {
  const s = (season || '').toLowerCase();
  if (s.includes('summer') && !s.includes('winter_brood')) {
    return 'SUMMER_BROOD_WINTER_LAY';
  }
  return 'WINTER_BROOD_SUMMER_LAY';
}

export function normalizeClientSex(genderOrSex: string): SexType {
  const g = (genderOrSex || '').toUpperCase();
  if (g.startsWith('M')) return 'MALE';
  return 'FEMALE';
}

export function getClientBenchmarkCurve(season: string, sex: string): BenchmarkPoint[] {
  const normSeason = normalizeClientSeason(season);
  const normSex = normalizeClientSex(sex);
  const table = normSeason === 'SUMMER_BROOD_WINTER_LAY' ? SUMMER_BROOD_STANDARDS : WINTER_BROOD_STANDARDS;
  return table.map(r => ({
    week: r.week,
    targetWeight: normSex === 'FEMALE' ? r.femaleWeight : r.maleWeight,
    weightGain: normSex === 'FEMALE' ? r.femaleGain : r.maleGain,
    feedGramsPerBirdDay: normSex === 'FEMALE' ? r.femaleFeed : r.maleFeed,
    minTargetWeight: Math.round((normSex === 'FEMALE' ? r.femaleWeight : r.maleWeight) * 0.9),
    maxTargetWeight: Math.round((normSex === 'FEMALE' ? r.femaleWeight : r.maleWeight) * 1.1),
  }));
}

export function getClientBenchmarkForWeek(season: string, sex: string, week: number): BenchmarkPoint {
  const curve = getClientBenchmarkCurve(season, sex);
  return curve.find(c => c.week === week) || curve[0];
}
