export interface TallyItem {
  weightGrams: number;
  birdCount: number;
}

export interface UniformityCalculationResult {
  totalBirds: number;
  averageWeight: number; // rounded to 1 decimal
  lightestWeight: number;
  heaviestWeight: number;
  weightRange: number;
  fValue: number;
  cvPercentF: number;      // CV% calculated using Range / (x_bar * F) * 100
  stdDev: number;          // Standard deviation
  cvPercentStd: number;    // Standard CV%: (stdDev / avg) * 100
  lowerLimit10Pct: number; // x_bar * 0.90
  upperLimit10Pct: number; // x_bar * 1.10
  birdsInUniformRange: number;
  uniformityPercent: number;
  underweightBirds: number;
  underweightPercent: number;
  overweightBirds: number;
  overweightPercent: number;
  status: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR';
  histogram: Array<{
    weight: number;
    count: number;
    percent: number;
    isUniform: boolean;
    isUnder: boolean;
    isOver: boolean;
  }>;
}

// F-Value lookup table based on Sample Size from Suguna Paper Chart
export const F_FACTOR_TABLE: Record<number, number> = {
  10: 3.08,
  15: 3.54,
  20: 3.73,
  25: 3.94,
  30: 4.09,
  35: 4.20,
  40: 4.30,
  45: 4.40,
  50: 4.50,
  55: 4.57,
  60: 4.64,
  65: 4.70,
  70: 4.76,
  75: 4.81,
  80: 4.87,
  85: 4.90,
  90: 4.94,
  95: 4.98,
  100: 5.02,
  150: 5.03,
};

export function getFFactor(sampleSize: number): number {
  if (sampleSize <= 10) return 3.08;
  if (sampleSize >= 150) return 5.03;

  const sampleSizes = Object.keys(F_FACTOR_TABLE)
    .map(Number)
    .sort((a, b) => a - b);

  if (F_FACTOR_TABLE[sampleSize]) {
    return F_FACTOR_TABLE[sampleSize];
  }

  // Linear interpolation between the two closest values
  for (let i = 0; i < sampleSizes.length - 1; i++) {
    const s1 = sampleSizes[i];
    const s2 = sampleSizes[i + 1];
    if (sampleSize >= s1 && sampleSize <= s2) {
      const f1 = F_FACTOR_TABLE[s1];
      const f2 = F_FACTOR_TABLE[s2];
      const ratio = (sampleSize - s1) / (s2 - s1);
      const interpolated = f1 + ratio * (f2 - f1);
      return Number(interpolated.toFixed(2));
    }
  }

  return 5.02;
}

export function calculateUniformity(tallies: TallyItem[]): UniformityCalculationResult {
  const validTallies = tallies
    .filter(t => t.birdCount > 0 && t.weightGrams > 0)
    .sort((a, b) => a.weightGrams - b.weightGrams);

  const totalBirds = validTallies.reduce((acc, cur) => acc + cur.birdCount, 0);

  if (totalBirds === 0) {
    return {
      totalBirds: 0,
      averageWeight: 0,
      lightestWeight: 0,
      heaviestWeight: 0,
      weightRange: 0,
      fValue: 3.08,
      cvPercentF: 0,
      stdDev: 0,
      cvPercentStd: 0,
      lowerLimit10Pct: 0,
      upperLimit10Pct: 0,
      birdsInUniformRange: 0,
      uniformityPercent: 0,
      underweightBirds: 0,
      underweightPercent: 0,
      overweightBirds: 0,
      overweightPercent: 0,
      status: 'POOR',
      histogram: [],
    };
  }

  const sumWeights = validTallies.reduce((acc, cur) => acc + cur.weightGrams * cur.birdCount, 0);
  const averageWeight = Math.round((sumWeights / totalBirds) * 10) / 10;

  const lightestWeight = validTallies[0].weightGrams;
  const heaviestWeight = validTallies[validTallies.length - 1].weightGrams;
  const weightRange = heaviestWeight - lightestWeight;

  const fValue = getFFactor(totalBirds);
  const cvPercentF = averageWeight > 0 && fValue > 0
    ? Number(((weightRange / (averageWeight * fValue)) * 100).toFixed(2))
    : 0;

  let sumSquaredDiffs = 0;
  for (const t of validTallies) {
    sumSquaredDiffs += t.birdCount * Math.pow(t.weightGrams - averageWeight, 2);
  }
  const variance = totalBirds > 1 ? sumSquaredDiffs / (totalBirds - 1) : 0;
  const stdDev = Number(Math.sqrt(variance).toFixed(1));
  const cvPercentStd = averageWeight > 0 ? Number(((stdDev / averageWeight) * 100).toFixed(2)) : 0;

  const lowerLimit10Pct = Math.round(averageWeight * 0.90 * 10) / 10;
  const upperLimit10Pct = Math.round(averageWeight * 1.10 * 10) / 10;

  let underweightBirds = 0;
  let birdsInUniformRange = 0;
  let overweightBirds = 0;

  const histogram = validTallies.map(t => {
    const isUnder = t.weightGrams < lowerLimit10Pct;
    const isOver = t.weightGrams > upperLimit10Pct;
    const isUniform = !isUnder && !isOver;

    if (isUnder) underweightBirds += t.birdCount;
    else if (isOver) overweightBirds += t.birdCount;
    else birdsInUniformRange += t.birdCount;

    return {
      weight: t.weightGrams,
      count: t.birdCount,
      percent: Number(((t.birdCount / totalBirds) * 100).toFixed(1)),
      isUniform,
      isUnder,
      isOver,
    };
  });

  const uniformityPercent = Number(((birdsInUniformRange / totalBirds) * 100).toFixed(1));
  const underweightPercent = Number(((underweightBirds / totalBirds) * 100).toFixed(1));
  const overweightPercent = Number(((overweightBirds / totalBirds) * 100).toFixed(1));

  let status: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR' = 'POOR';
  if (uniformityPercent >= 80) status = 'EXCELLENT';
  else if (uniformityPercent >= 70) status = 'ACCEPTABLE';

  return {
    totalBirds,
    averageWeight,
    lightestWeight,
    heaviestWeight,
    weightRange,
    fValue,
    cvPercentF,
    stdDev,
    cvPercentStd,
    lowerLimit10Pct,
    upperLimit10Pct,
    birdsInUniformRange,
    uniformityPercent,
    underweightBirds,
    underweightPercent,
    overweightBirds,
    overweightPercent,
    status,
    histogram,
  };
}

export function calculatePerformanceAlerts(params: {
  actualAvgWeight: number;
  targetWeight: number;
  standardFeedGrams: number;
  uniformityPercent: number;
  ageWeeks: number;
}) {
  const { actualAvgWeight, targetWeight, standardFeedGrams, uniformityPercent } = params;

  const diffGrams = Math.round((actualAvgWeight - targetWeight) * 10) / 10;
  const diffPercent = targetWeight > 0 ? Number(((diffGrams / targetWeight) * 100).toFixed(1)) : 0;

  let feedAdjustmentGrams = 0;
  let feedRecommendation = '';
  let gradingAdvice = '';

  if (diffPercent < -5) {
    feedAdjustmentGrams = +3.5;
    feedRecommendation = `Flock is ${Math.abs(diffPercent)}% underweight. Increase feed by +3 to +4 g/bird/day immediately to restore target growth trajectory.`;
  } else if (diffPercent < -2) {
    feedAdjustmentGrams = +1.5;
    feedRecommendation = `Flock is ${Math.abs(diffPercent)}% below target. Increase daily feed by +1.5 g/bird/day above standard.`;
  } else if (diffPercent > 5) {
    feedAdjustmentGrams = -1;
    feedRecommendation = `Flock is ${diffPercent}% overweight. Hold feed at current level (do not increase this week). Avoid harsh cuts.`;
  } else if (diffPercent > 2) {
    feedAdjustmentGrams = 0;
    feedRecommendation = `Flock is slightly heavy (+${diffPercent}%). Maintain standard feed allocation without weekly standard bump.`;
  } else {
    feedAdjustmentGrams = 0;
    feedRecommendation = `Flock is right on target growth curve (within ±2%). Maintain standard seasonal feeding schedule.`;
  }

  const suggestedDailyFeed = Math.max(20, Math.round((standardFeedGrams + feedAdjustmentGrams) * 10) / 10);

  if (uniformityPercent >= 80) {
    gradingAdvice = 'Uniformity is Excellent (≥ 80%). No pen grading required. Continue standard feeder management.';
  } else if (uniformityPercent >= 70) {
    gradingAdvice = 'Uniformity is Acceptable (70-79%). Ensure equal feeder chain distribution and adequate feed space (≥ 15 cm/bird).';
  } else {
    gradingAdvice = 'Uniformity is Poor (< 70%). Immediate flock grading into Light, Medium, and Heavy pens is strongly recommended.';
  }

  return {
    diffGrams,
    diffPercent,
    standardFeedGrams,
    suggestedDailyFeed,
    feedAdjustmentGrams,
    feedRecommendation,
    gradingAdvice,
    severity: uniformityPercent >= 80 ? 'green' : uniformityPercent >= 70 ? 'yellow' : 'red',
  };
}

/**
 * SHED-WISE AGGREGATION ENGINE
 */
export interface PenSampleData {
  penId: string;
  penNumber: string;
  sex: 'FEMALE' | 'MALE';
  breed: string;
  liveBirdCount: number;
  tallies: TallyItem[];
  targetWeight: number;
  standardFeedGrams: number;
}

export interface PenAnalysisResult {
  penId: string;
  penNumber: string;
  sex: 'FEMALE' | 'MALE';
  breed: string;
  liveBirdCount: number;
  sampleSize: number;
  averageWeight: number;
  uniformityPercent: number;
  cvPercent: number;
  stdDev: number;
  status: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR';
  suggestedFeedGrams: number;
  dailyFeedKg: number;
  feedBags50kg: number;
  deviationFromShedMeanGrams: number;
  deviationFromShedMeanPercent: number;
  hasDeviationAlert: boolean; // true if |deviation| > 5%
  alertMessage?: string;
  histogram: UniformityCalculationResult['histogram'];
}

export interface ShedSummaryResult {
  totalPens: number;
  totalLiveBirds: number;
  totalSampleBirdsWeighed: number;
  shedAverageWeight: number; // Weighted average X_shed
  shedLowerLimit10Pct: number;
  shedUpperLimit10Pct: number;
  shedBirdsInUniformRange: number;
  shedUniformityPercent: number; // Uniformity based on shed mean
  shedStatus: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR';
  totalDailyFeedKg: number;
  totalFeedBags50kg: number;
  pens: PenAnalysisResult[];
  deviatingPensCount: number;
  alerts: string[];
  compositeHistogram: Array<{
    weight: number;
    totalCount: number;
    penBreakdown: Record<string, number>;
    isWithinShedRange: boolean;
  }>;
}

export function calculateShedAggregation(pensData: PenSampleData[]): ShedSummaryResult {
  const activePens = pensData.filter(p => p.tallies.some(t => t.birdCount > 0));

  if (activePens.length === 0) {
    return {
      totalPens: pensData.length,
      totalLiveBirds: pensData.reduce((acc, p) => acc + p.liveBirdCount, 0),
      totalSampleBirdsWeighed: 0,
      shedAverageWeight: 0,
      shedLowerLimit10Pct: 0,
      shedUpperLimit10Pct: 0,
      shedBirdsInUniformRange: 0,
      shedUniformityPercent: 0,
      shedStatus: 'POOR',
      totalDailyFeedKg: 0,
      totalFeedBags50kg: 0,
      pens: [],
      deviatingPensCount: 0,
      alerts: ['No active weighing data recorded for any pen in this shed.'],
      compositeHistogram: [],
    };
  }

  // 1. Calculate each pen's individual statistics
  const penStatsMap = activePens.map(p => {
    const stats = calculateUniformity(p.tallies);
    const alerts = calculatePerformanceAlerts({
      actualAvgWeight: stats.averageWeight,
      targetWeight: p.targetWeight,
      standardFeedGrams: p.standardFeedGrams,
      uniformityPercent: stats.uniformityPercent,
      ageWeeks: 12,
    });
    const dailyFeedKg = Number(((p.liveBirdCount * alerts.suggestedDailyFeed) / 1000).toFixed(2));
    const feedBags50kg = Number((dailyFeedKg / 50).toFixed(2));

    return {
      pen: p,
      stats,
      alerts,
      dailyFeedKg,
      feedBags50kg,
    };
  });

  // 2. Shed-Wise Aggregated Average Weight (X_shed)
  // X_shed = sum(all weights * bird count) / total shed sample birds
  let grandSumWeights = 0;
  let totalSampleBirds = 0;
  let totalLiveBirds = 0;
  let totalDailyFeedKg = 0;

  for (const item of penStatsMap) {
    const penBirds = item.stats.totalBirds;
    grandSumWeights += item.stats.averageWeight * penBirds;
    totalSampleBirds += penBirds;
    totalLiveBirds += item.pen.liveBirdCount;
    totalDailyFeedKg += item.dailyFeedKg;
  }

  const shedAverageWeight = totalSampleBirds > 0
    ? Math.round((grandSumWeights / totalSampleBirds) * 10) / 10
    : 0;

  const shedLowerLimit10Pct = Math.round(shedAverageWeight * 0.90 * 10) / 10;
  const shedUpperLimit10Pct = Math.round(shedAverageWeight * 1.10 * 10) / 10;

  // 3. Shed-Wise Overall Uniformity (%_shed) based on overall shed average
  let shedBirdsInUniformRange = 0;
  const weightMap = new Map<number, { total: number; breakdown: Record<string, number> }>();

  for (const item of penStatsMap) {
    for (const t of item.pen.tallies) {
      if (t.birdCount <= 0) continue;
      // Check if this weight is within shed range [X_shed * 0.90, X_shed * 1.10]
      if (t.weightGrams >= shedLowerLimit10Pct && t.weightGrams <= shedUpperLimit10Pct) {
        shedBirdsInUniformRange += t.birdCount;
      }
      // Populate composite histogram
      const entry = weightMap.get(t.weightGrams) || { total: 0, breakdown: {} };
      entry.total += t.birdCount;
      entry.breakdown[item.pen.penNumber] = (entry.breakdown[item.pen.penNumber] || 0) + t.birdCount;
      weightMap.set(t.weightGrams, entry);
    }
  }

  const shedUniformityPercent = totalSampleBirds > 0
    ? Number(((shedBirdsInUniformRange / totalSampleBirds) * 100).toFixed(1))
    : 0;

  let shedStatus: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR' = 'POOR';
  if (shedUniformityPercent >= 80) shedStatus = 'EXCELLENT';
  else if (shedUniformityPercent >= 70) shedStatus = 'ACCEPTABLE';

  const totalFeedBags50kg = Number((totalDailyFeedKg / 50).toFixed(2));

  // 4. Evaluate Pen Deviations from Shed Mean & Generate Alerts
  const alerts: string[] = [];
  const analyzedPens: PenAnalysisResult[] = penStatsMap.map(item => {
    const penAvg = item.stats.averageWeight;
    const devGrams = Math.round((penAvg - shedAverageWeight) * 10) / 10;
    const devPercent = shedAverageWeight > 0
      ? Number(((devGrams / shedAverageWeight) * 100).toFixed(1))
      : 0;

    const hasDeviationAlert = Math.abs(devPercent) > 5.0;
    let alertMessage: string | undefined;

    if (hasDeviationAlert) {
      alertMessage = `${item.pen.penNumber} (${item.pen.sex}) deviates by ${devPercent > 0 ? '+' : ''}${devPercent}% from the Shed average (${devGrams > 0 ? '+' : ''}${devGrams}g). Check feeder delivery and grading.`;
      alerts.push(alertMessage);
    }

    return {
      penId: item.pen.penId,
      penNumber: item.pen.penNumber,
      sex: item.pen.sex,
      breed: item.pen.breed,
      liveBirdCount: item.pen.liveBirdCount,
      sampleSize: item.stats.totalBirds,
      averageWeight: penAvg,
      uniformityPercent: item.stats.uniformityPercent,
      cvPercent: item.stats.cvPercentF,
      stdDev: item.stats.stdDev,
      status: item.stats.status,
      suggestedFeedGrams: item.alerts.suggestedDailyFeed,
      dailyFeedKg: item.dailyFeedKg,
      feedBags50kg: item.feedBags50kg,
      deviationFromShedMeanGrams: devGrams,
      deviationFromShedMeanPercent: devPercent,
      hasDeviationAlert,
      alertMessage,
      histogram: item.stats.histogram,
    };
  });

  // Sort composite histogram by weight
  const compositeHistogram = Array.from(weightMap.entries())
    .map(([w, val]) => ({
      weight: w,
      totalCount: val.total,
      penBreakdown: val.breakdown,
      isWithinShedRange: w >= shedLowerLimit10Pct && w <= shedUpperLimit10Pct,
    }))
    .sort((a, b) => a.weight - b.weight);

  return {
    totalPens: pensData.length,
    totalLiveBirds,
    totalSampleBirdsWeighed: totalSampleBirds,
    shedAverageWeight,
    shedLowerLimit10Pct,
    shedUpperLimit10Pct,
    shedBirdsInUniformRange,
    shedUniformityPercent,
    shedStatus,
    totalDailyFeedKg: Number(totalDailyFeedKg.toFixed(2)),
    totalFeedBags50kg,
    pens: analyzedPens,
    deviatingPensCount: alerts.length,
    alerts,
    compositeHistogram,
  };
}
