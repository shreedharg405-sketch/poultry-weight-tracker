export type SeasonType = 'WINTER_BROOD_SUMMER_LAY' | 'SUMMER_BROOD_WINTER_LAY';
export type SexType = 'FEMALE' | 'MALE';
export type UniformityStatus = 'EXCELLENT' | 'ACCEPTABLE' | 'POOR';

export interface Farm {
  id: string;
  name: string;
  location?: string;
  createdAt: string;
}

export interface Shed {
  id: string;
  farmId: string;
  shedName: string;
  season: SeasonType;
  hatchDate?: string;
  createdAt: string;
  pensCount?: number;
  totalLiveBirds?: number;
  farmName?: string;
  farmLocation?: string;
  pens?: Pen[];
}

export interface Pen {
  id: string;
  shedId: string;
  penNumber: string;
  sex: SexType;
  breed: string;
  liveBirdCount: number;
  createdAt: string;
}

export interface Flock {
  id: string;
  farmName: string;
  houseNo: string;
  penNo: string;
  breed: string;
  sex: SexType;
  hatchDate?: string;
  season: SeasonType;
  initialBirdCount: number;
  createdAt: string;
  updatedAt: string;
  latestWeighing?: WeighingRecord | null;
  totalWeighingsCount?: number;
}

export interface TallyItem {
  weightGrams: number;
  birdCount: number;
}

export interface UniformityStats {
  totalBirds: number;
  averageWeight: number;
  lightestWeight: number;
  heaviestWeight: number;
  weightRange: number;
  fValue: number;
  cvPercentF: number;
  stdDev: number;
  cvPercentStd: number;
  lowerLimit10Pct: number;
  upperLimit10Pct: number;
  birdsInUniformRange: number;
  uniformityPercent: number;
  underweightBirds: number;
  underweightPercent: number;
  overweightBirds: number;
  overweightPercent: number;
  status: UniformityStatus;
  histogram: Array<{
    weight: number;
    count: number;
    percent: number;
    isUniform: boolean;
    isUnder: boolean;
    isOver: boolean;
  }>;
}

export interface PerformanceAlerts {
  diffGrams: number;
  diffPercent: number;
  standardFeedGrams: number;
  suggestedDailyFeed: number;
  feedAdjustmentGrams: number;
  feedRecommendation: string;
  gradingAdvice: string;
  severity: 'green' | 'yellow' | 'red';
}

export interface WeighingRecord {
  id: string;
  penId: string;
  flockId?: string;
  ageWeeks: number;
  weighDate: string;
  targetWeight: number;
  actualAvgWeight: number;
  sampleSize: number;
  uniformityPercent: number;
  cvPercent: number;
  stdDev: number;
  lightestWeight: number;
  heaviestWeight: number;
  weightRange: number;
  fValue: number;
  underCount: number;
  uniformCount: number;
  overCount: number;
  status: UniformityStatus;
  suggestedFeedGrams: number;
  targetFeedGrams: number;
  weighedBy?: string;
  notes?: string;
  createdAt: string;
  tallies: TallyItem[];
}

export interface BenchmarkPoint {
  week: number;
  targetWeight: number;
  weightGain: number;
  feedGramsPerBirdDay: number;
  minTargetWeight: number;
  maxTargetWeight: number;
  actualWeight?: number;
}

export interface PenAnalysisItem {
  penId: string;
  penNumber: string;
  sex: SexType;
  breed: string;
  liveBirdCount: number;
  sampleSize: number;
  averageWeight: number;
  uniformityPercent: number;
  cvPercent: number;
  stdDev: number;
  status: UniformityStatus;
  suggestedFeedGrams: number;
  dailyFeedKg: number;
  feedBags50kg: number;
  deviationFromShedMeanGrams: number;
  deviationFromShedMeanPercent: number;
  hasDeviationAlert: boolean;
  alertMessage?: string;
}

export interface ShedSummaryData {
  totalPens: number;
  totalLiveBirds: number;
  totalSampleBirdsWeighed: number;
  shedAverageWeight: number;
  shedLowerLimit10Pct: number;
  shedUpperLimit10Pct: number;
  shedBirdsInUniformRange: number;
  shedUniformityPercent: number;
  shedStatus: UniformityStatus;
  totalDailyFeedKg: number;
  totalFeedBags50kg: number;
  pens: PenAnalysisItem[];
  deviatingPensCount: number;
  alerts: string[];
  compositeHistogram: Array<{
    weight: number;
    totalCount: number;
    penBreakdown: Record<string, number>;
    isWithinShedRange: boolean;
  }>;
}

export interface ShedComparisonItem {
  shedId: string;
  shedName: string;
  season: SeasonType;
  totalPens: number;
  totalLiveBirds: number;
  totalSampleBirdsWeighed: number;
  shedAverageWeight: number;
  shedUniformityPercent: number;
  shedStatus: UniformityStatus;
  totalDailyFeedKg: number;
  totalFeedBags50kg: number;
  deviatingPensCount: number;
  alertsCount: number;
}
