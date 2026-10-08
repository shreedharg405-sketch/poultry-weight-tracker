import { prisma } from './prisma.js';
import {
  calculateUniformity,
  calculatePerformanceAlerts,
  calculateShedAggregation,
  TallyItem,
  ShedSummaryResult,
  PenSampleData,
} from '../services/calculationEngine.js';
import { getBenchmarkCurve, getBenchmarkForWeek, SeasonType } from '../data/benchmarks.js';

export interface FarmEntity {
  id: string;
  name: string;
  location?: string;
  createdAt: string;
}

export interface ShedEntity {
  id: string;
  farmId: string;
  shedName: string;
  season: SeasonType;
  hatchDate?: string;
  createdAt: string;
}

export interface PenEntity {
  id: string;
  shedId: string;
  penNumber: string;
  sex: 'FEMALE' | 'MALE';
  breed: string;
  liveBirdCount: number;
  createdAt: string;
}

export interface WeighingRecordEntity {
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
  status: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR';
  suggestedFeedGrams: number;
  targetFeedGrams: number;
  weighedBy?: string;
  notes?: string;
  createdAt: string;
  tallies: TallyItem[];
}

// In-Memory Seed Data
const MEMORY_FARMS: FarmEntity[] = [
  { id: 'farm-1', name: 'Suguna Breeder Complex Unit 4', location: 'Udumalpet, Tamil Nadu', createdAt: new Date().toISOString() },
  { id: 'farm-2', name: 'Coimbatore Valley Broiler Farm', location: 'Pollachi Road, Coimbatore', createdAt: new Date().toISOString() }
];

const MEMORY_SHEDS: ShedEntity[] = [
  { id: 'shed-1', farmId: 'farm-1', shedName: 'Shed 1 (Grower House)', season: 'WINTER_BROOD_SUMMER_LAY', hatchDate: '2026-06-15', createdAt: new Date().toISOString() },
  { id: 'shed-2', farmId: 'farm-1', shedName: 'Shed 2 (Grower House)', season: 'WINTER_BROOD_SUMMER_LAY', hatchDate: '2026-06-15', createdAt: new Date().toISOString() },
  { id: 'shed-3', farmId: 'farm-1', shedName: 'Shed 3 (Summer Brood)', season: 'SUMMER_BROOD_WINTER_LAY', hatchDate: '2026-07-01', createdAt: new Date().toISOString() }
];

const MEMORY_PENS: PenEntity[] = [
  // Shed 1 Pens
  { id: 'pen-1a', shedId: 'shed-1', penNumber: 'Pen A', sex: 'FEMALE', breed: 'Cobb 500', liveBirdCount: 4800, createdAt: new Date().toISOString() },
  { id: 'pen-1b', shedId: 'shed-1', penNumber: 'Pen B', sex: 'MALE', breed: 'Cobb 500', liveBirdCount: 520, createdAt: new Date().toISOString() },
  { id: 'pen-1c', shedId: 'shed-1', penNumber: 'Pen C', sex: 'FEMALE', breed: 'Cobb 500', liveBirdCount: 4750, createdAt: new Date().toISOString() },

  // Shed 2 Pens
  { id: 'pen-2a', shedId: 'shed-2', penNumber: 'Pen 1', sex: 'FEMALE', breed: 'Cobb 500', liveBirdCount: 5000, createdAt: new Date().toISOString() },
  { id: 'pen-2b', shedId: 'shed-2', penNumber: 'Pen 2', sex: 'MALE', breed: 'Cobb 500', liveBirdCount: 540, createdAt: new Date().toISOString() },

  // Shed 3 Pens
  { id: 'pen-3a', shedId: 'shed-3', penNumber: 'Pen North', sex: 'FEMALE', breed: 'Ross 308', liveBirdCount: 4900, createdAt: new Date().toISOString() },
  { id: 'pen-3b', shedId: 'shed-3', penNumber: 'Pen South', sex: 'MALE', breed: 'Ross 308', liveBirdCount: 510, createdAt: new Date().toISOString() },
];

// Helper to make realistic sample tallies around mean
function makeTallies(target: number, step: number = 20, birdCount: number = 100): TallyItem[] {
  const center = Math.round(target / step) * step;
  const distribution = [3, 7, 14, 25, 26, 15, 7, 2, 1];
  const offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
  return offsets.map((off, i) => ({
    weightGrams: center + off * step,
    birdCount: distribution[i],
  }));
}

const tallies1A = makeTallies(1260, 20); // Pen A: on target 1260g (F)
const tallies1B = makeTallies(1770, 50); // Pen B: on target 1770g (M)
const tallies1C = makeTallies(1210, 20); // Pen C: underweight 1210g (-4% dev)

function recordFromTallies(penId: string, ageWeeks: number, tallies: TallyItem[], targetWeight: number, feedGrams: number): WeighingRecordEntity {
  const stats = calculateUniformity(tallies);
  const alerts = calculatePerformanceAlerts({
    actualAvgWeight: stats.averageWeight,
    targetWeight,
    standardFeedGrams: feedGrams,
    uniformityPercent: stats.uniformityPercent,
    ageWeeks,
  });

  return {
    id: `rec-${penId}-w${ageWeeks}`,
    penId,
    flockId: penId,
    ageWeeks,
    weighDate: new Date().toISOString().split('T')[0],
    targetWeight,
    actualAvgWeight: stats.averageWeight,
    sampleSize: stats.totalBirds,
    uniformityPercent: stats.uniformityPercent,
    cvPercent: stats.cvPercentF,
    stdDev: stats.stdDev,
    lightestWeight: stats.lightestWeight,
    heaviestWeight: stats.heaviestWeight,
    weightRange: stats.weightRange,
    fValue: stats.fValue,
    underCount: stats.underweightBirds,
    uniformCount: stats.birdsInUniformRange,
    overCount: stats.overweightBirds,
    status: stats.status,
    suggestedFeedGrams: alerts.suggestedDailyFeed,
    targetFeedGrams: feedGrams,
    weighedBy: 'K. Rajan',
    notes: 'Sampled across 3 catching pens.',
    createdAt: new Date().toISOString(),
    tallies,
  };
}

const MEMORY_RECORDS: WeighingRecordEntity[] = [
  recordFromTallies('pen-1a', 12, tallies1A, 1260, 55),
  recordFromTallies('pen-1b', 12, tallies1B, 1770, 77),
  recordFromTallies('pen-1c', 12, tallies1C, 1260, 55),
];

export const FarmService = {
  async getAll(): Promise<FarmEntity[]> {
    return MEMORY_FARMS;
  },
  async getById(id: string): Promise<FarmEntity | null> {
    return MEMORY_FARMS.find(f => f.id === id) || null;
  }
};

export const ShedService = {
  async getAll(): Promise<ShedEntity[]> {
    return MEMORY_SHEDS;
  },

  async getById(id: string): Promise<ShedEntity | null> {
    return MEMORY_SHEDS.find(s => s.id === id) || null;
  },

  async getPensByShedId(shedId: string): Promise<PenEntity[]> {
    return MEMORY_PENS.filter(p => p.shedId === shedId);
  },

  async create(data: { farmId: string; shedName: string; season: SeasonType; hatchDate?: string }): Promise<ShedEntity> {
    const newShed: ShedEntity = {
      ...data,
      id: `shed-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    MEMORY_SHEDS.push(newShed);
    return newShed;
  },

  async getShedSummary(shedId: string, week: number = 12): Promise<{ shed: ShedEntity; farm: FarmEntity | null; summary: ShedSummaryResult }> {
    const shed = await this.getById(shedId);
    if (!shed) throw new Error('Shed not found');
    const farm = await FarmService.getById(shed.farmId);
    const pens = await this.getPensByShedId(shedId);

    const pensSampleData: PenSampleData[] = await Promise.all(
      pens.map(async (pen) => {
        const records = MEMORY_RECORDS.filter(r => r.penId === pen.id && r.ageWeeks === week);
        const record = records.length > 0 ? records[records.length - 1] : null;
        const benchmark = getBenchmarkForWeek(shed.season, pen.sex, week);

        return {
          penId: pen.id,
          penNumber: pen.penNumber,
          sex: pen.sex,
          breed: pen.breed,
          liveBirdCount: pen.liveBirdCount,
          tallies: record ? record.tallies : [],
          targetWeight: benchmark.targetWeight,
          standardFeedGrams: benchmark.feedGramsPerBirdDay,
        };
      })
    );

    const summary = calculateShedAggregation(pensSampleData);
    return { shed, farm, summary };
  },

  async compareAllSheds(week: number = 12) {
    const sheds = await this.getAll();
    const comparisons = await Promise.all(
      sheds.map(async (s) => {
        const { summary } = await this.getShedSummary(s.id, week);
        return {
          shedId: s.id,
          shedName: s.shedName,
          season: s.season,
          totalPens: summary.totalPens,
          totalLiveBirds: summary.totalLiveBirds,
          totalSampleBirdsWeighed: summary.totalSampleBirdsWeighed,
          shedAverageWeight: summary.shedAverageWeight,
          shedUniformityPercent: summary.shedUniformityPercent,
          shedStatus: summary.shedStatus,
          totalDailyFeedKg: summary.totalDailyFeedKg,
          totalFeedBags50kg: summary.totalFeedBags50kg,
          deviatingPensCount: summary.deviatingPensCount,
          alertsCount: summary.alerts.length,
        };
      })
    );
    return comparisons;
  }
};

export const PenService = {
  async getAll(): Promise<PenEntity[]> {
    return MEMORY_PENS;
  },

  async getById(id: string): Promise<PenEntity | null> {
    return MEMORY_PENS.find(p => p.id === id) || null;
  },

  async create(data: { shedId: string; penNumber: string; sex: 'FEMALE' | 'MALE'; breed: string; liveBirdCount: number }): Promise<PenEntity> {
    const newPen: PenEntity = {
      ...data,
      id: `pen-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    MEMORY_PENS.push(newPen);
    return newPen;
  }
};

export const WeighingService = {
  async getByPenId(penId: string): Promise<WeighingRecordEntity[]> {
    return MEMORY_RECORDS.filter(r => r.penId === penId);
  },

  async getByFlockId(flockId: string): Promise<WeighingRecordEntity[]> {
    return MEMORY_RECORDS.filter(r => r.penId === flockId || r.flockId === flockId);
  },

  async getById(id: string): Promise<WeighingRecordEntity | null> {
    return MEMORY_RECORDS.find(r => r.id === id) || null;
  },

  async create(payload: {
    penId?: string;
    flockId?: string;
    ageWeeks: number;
    weighDate?: string;
    tallies: TallyItem[];
    weighedBy?: string;
    notes?: string;
  }): Promise<WeighingRecordEntity> {
    const targetPenId = payload.penId || payload.flockId;
    if (!targetPenId) throw new Error('Pen ID or Flock ID required');
    const pen = await PenService.getById(targetPenId);
    if (!pen) throw new Error('Pen not found');
    const shed = await ShedService.getById(pen.shedId);
    const benchmark = getBenchmarkForWeek(shed?.season || 'WINTER_BROOD_SUMMER_LAY', pen.sex, payload.ageWeeks);

    const record = recordFromTallies(
      targetPenId,
      payload.ageWeeks,
      payload.tallies,
      benchmark.targetWeight,
      benchmark.feedGramsPerBirdDay
    );
    record.weighedBy = payload.weighedBy || record.weighedBy;
    record.notes = payload.notes;

    const existingIdx = MEMORY_RECORDS.findIndex(r => r.penId === targetPenId && r.ageWeeks === payload.ageWeeks);
    if (existingIdx >= 0) {
      MEMORY_RECORDS[existingIdx] = record;
    } else {
      MEMORY_RECORDS.push(record);
    }
    return record;
  }
};

// Backwards-compatible FlockService mapping
export const FlockService = {
  async getAll() {
    return MEMORY_PENS.map(pen => {
      const shed = MEMORY_SHEDS.find(s => s.id === pen.shedId);
      const farm = MEMORY_FARMS.find(f => f.id === shed?.farmId);
      const weighings = MEMORY_RECORDS.filter(r => r.penId === pen.id);
      return {
        id: pen.id,
        farmName: `${farm?.name || 'Suguna Complex'} - ${shed?.shedName}`,
        houseNo: shed?.shedName || 'Shed 1',
        penNo: pen.penNumber,
        breed: pen.breed,
        sex: pen.sex,
        season: shed?.season || 'WINTER_BROOD_SUMMER_LAY',
        initialBirdCount: pen.liveBirdCount,
        createdAt: pen.createdAt,
        updatedAt: pen.createdAt,
        latestWeighing: weighings.length > 0 ? weighings[weighings.length - 1] : null,
        totalWeighingsCount: weighings.length,
      };
    });
  },

  async getById(id: string) {
    const pen = MEMORY_PENS.find(p => p.id === id);
    if (!pen) return null;
    const shed = MEMORY_SHEDS.find(s => s.id === pen.shedId);
    const farm = MEMORY_FARMS.find(f => f.id === shed?.farmId);
    const weighings = MEMORY_RECORDS.filter(r => r.penId === pen.id);
    return {
      id: pen.id,
      farmName: `${farm?.name || 'Suguna Complex'} - ${shed?.shedName}`,
      houseNo: shed?.shedName || 'Shed 1',
      penNo: pen.penNumber,
      breed: pen.breed,
      sex: pen.sex,
      season: shed?.season || 'WINTER_BROOD_SUMMER_LAY',
      initialBirdCount: pen.liveBirdCount,
      createdAt: pen.createdAt,
      updatedAt: pen.createdAt,
      latestWeighing: weighings.length > 0 ? weighings[weighings.length - 1] : null,
      totalWeighingsCount: weighings.length,
    };
  },

  async create(data: any) {
    const newPen = await PenService.create({
      shedId: 'shed-1',
      penNumber: data.penNo,
      sex: data.sex,
      breed: data.breed || 'Cobb 500',
      liveBirdCount: data.initialBirdCount || 4800,
    });
    return (await this.getById(newPen.id))!;
  }
};
