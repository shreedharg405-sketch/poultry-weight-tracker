import { prisma } from './db/prisma.js';
import { WINTER_BROOD_STANDARDS, SUMMER_BROOD_STANDARDS } from './data/benchmarks.js';
import { calculateUniformity, calculatePerformanceAlerts } from './services/calculationEngine.js';

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Clear existing seed data in safe order
  try {
    await prisma.weightTally.deleteMany({});
    await prisma.weighingSession.deleteMany({});
    await prisma.weighingRecord.deleteMany({});
    await prisma.flock.deleteMany({});
    await prisma.pen.deleteMany({});
    await prisma.shed.deleteMany({});
    await prisma.farm.deleteMany({});
    await prisma.benchmarkStandard.deleteMany({});
    await prisma.seasonalBenchmark.deleteMany({});
  } catch (err) {
    console.warn('Note: Delete error (tables may be newly created):', err);
  }

  // 2. Seed Seasonal Benchmarks for both tables
  console.log('📊 Seeding Benchmark Standards (Weeks 1 to 23)...');
  for (const row of WINTER_BROOD_STANDARDS) {
    // SeasonalBenchmark (backward compatibility)
    await prisma.seasonalBenchmark.create({
      data: {
        season: 'WINTER_BROOD_SUMMER_LAY',
        sex: 'FEMALE',
        week: row.week,
        targetWeight: row.femaleWeight,
        weightGain: row.femaleGain,
        feedGramsPerBirdDay: row.femaleFeed,
        minWeight: Math.round(row.femaleWeight * 0.9),
        maxWeight: Math.round(row.femaleWeight * 1.1),
      }
    });
    await prisma.seasonalBenchmark.create({
      data: {
        season: 'WINTER_BROOD_SUMMER_LAY',
        sex: 'MALE',
        week: row.week,
        targetWeight: row.maleWeight,
        weightGain: row.maleGain,
        feedGramsPerBirdDay: row.maleFeed,
        minWeight: Math.round(row.maleWeight * 0.9),
        maxWeight: Math.round(row.maleWeight * 1.1),
      }
    });

    // BenchmarkStandard model
    await prisma.benchmarkStandard.create({
      data: {
        season: 'WINTER_BROOD_SUMMER_LAY',
        gender: 'FEMALE',
        week: row.week,
        targetWeight: row.femaleWeight,
        weightGain: row.femaleGain,
        feedGramsPerBirdDay: row.femaleFeed,
        minWeight: Math.round(row.femaleWeight * 0.9),
        maxWeight: Math.round(row.femaleWeight * 1.1),
      }
    });
    await prisma.benchmarkStandard.create({
      data: {
        season: 'WINTER_BROOD_SUMMER_LAY',
        gender: 'MALE',
        week: row.week,
        targetWeight: row.maleWeight,
        weightGain: row.maleGain,
        feedGramsPerBirdDay: row.maleFeed,
        minWeight: Math.round(row.maleWeight * 0.9),
        maxWeight: Math.round(row.maleWeight * 1.1),
      }
    });
  }

  for (const row of SUMMER_BROOD_STANDARDS) {
    await prisma.seasonalBenchmark.create({
      data: {
        season: 'SUMMER_BROOD_WINTER_LAY',
        sex: 'FEMALE',
        week: row.week,
        targetWeight: row.femaleWeight,
        weightGain: row.femaleGain,
        feedGramsPerBirdDay: row.femaleFeed,
        minWeight: Math.round(row.femaleWeight * 0.9),
        maxWeight: Math.round(row.femaleWeight * 1.1),
      }
    });
    await prisma.seasonalBenchmark.create({
      data: {
        season: 'SUMMER_BROOD_WINTER_LAY',
        sex: 'MALE',
        week: row.week,
        targetWeight: row.maleWeight,
        weightGain: row.maleGain,
        feedGramsPerBirdDay: row.maleFeed,
        minWeight: Math.round(row.maleWeight * 0.9),
        maxWeight: Math.round(row.maleWeight * 1.1),
      }
    });

    await prisma.benchmarkStandard.create({
      data: {
        season: 'SUMMER_BROOD_WINTER_LAY',
        gender: 'FEMALE',
        week: row.week,
        targetWeight: row.femaleWeight,
        weightGain: row.femaleGain,
        feedGramsPerBirdDay: row.femaleFeed,
        minWeight: Math.round(row.femaleWeight * 0.9),
        maxWeight: Math.round(row.femaleWeight * 1.1),
      }
    });
    await prisma.benchmarkStandard.create({
      data: {
        season: 'SUMMER_BROOD_WINTER_LAY',
        gender: 'MALE',
        week: row.week,
        targetWeight: row.maleWeight,
        weightGain: row.maleGain,
        feedGramsPerBirdDay: row.maleFeed,
        minWeight: Math.round(row.maleWeight * 0.9),
        maxWeight: Math.round(row.maleWeight * 1.1),
      }
    });
  }
  console.log('✅ Seeded 92 seasonal benchmark standard rows (Winter & Summer, Female & Male)');

  // 3. Create Demo Farms, Sheds, Pens, and Flocks
  const farm1 = await prisma.farm.create({
    data: {
      id: 'farm-1',
      name: 'Suguna Breeder Complex Unit 4',
      location: 'Udumalpet, Tamil Nadu',
    }
  });

  const farm2 = await prisma.farm.create({
    data: {
      id: 'farm-2',
      name: 'Coimbatore Valley Broiler Farm',
      location: 'Pollachi Road, Coimbatore',
    }
  });

  const shed1 = await prisma.shed.create({
    data: {
      id: 'shed-1',
      farmId: farm1.id,
      shedName: 'Shed 1 (Grower House)',
      season: 'WINTER_BROOD_SUMMER_LAY',
      hatchDate: new Date('2026-06-15'),
    }
  });

  const shed2 = await prisma.shed.create({
    data: {
      id: 'shed-2',
      farmId: farm1.id,
      shedName: 'Shed 2 (Grower House)',
      season: 'WINTER_BROOD_SUMMER_LAY',
      hatchDate: new Date('2026-06-15'),
    }
  });

  const pen1a = await prisma.pen.create({
    data: {
      id: 'pen-1a',
      shedId: shed1.id,
      penNumber: 'Pen A',
      sex: 'FEMALE',
      breed: 'Cobb 500',
      liveBirdCount: 4800,
    }
  });

  const pen1b = await prisma.pen.create({
    data: {
      id: 'pen-1b',
      shedId: shed1.id,
      penNumber: 'Pen B',
      sex: 'MALE',
      breed: 'Cobb 500',
      liveBirdCount: 520,
    }
  });

  const pen1c = await prisma.pen.create({
    data: {
      id: 'pen-1c',
      shedId: shed1.id,
      penNumber: 'Pen C',
      sex: 'FEMALE',
      breed: 'Cobb 500',
      liveBirdCount: 4750,
    }
  });

  // Create Flocks
  const flock1 = await prisma.flock.create({
    data: {
      id: 'flock-demo-1',
      farmId: farm1.id,
      shedId: shed1.id,
      penId: pen1a.id,
      farmName: farm1.name,
      houseNo: shed1.shedName,
      penNo: pen1a.penNumber,
      breed: 'Cobb 500',
      sex: 'FEMALE',
      season: 'WINTER_BROOD_SUMMER_LAY',
      hatchDate: new Date('2026-06-15'),
      initialBirdCount: 4800,
      currentBirdCount: 4800,
    }
  });

  console.log('✅ Seeded demo Farms, Sheds, Pens, and Flocks');

  // 4. Seed sample historical weighings for Pen A: Week 12
  const week12Tallies = [
    { weightGrams: 1140, birdCount: 2 },
    { weightGrams: 1160, birdCount: 4 },
    { weightGrams: 1180, birdCount: 7 },
    { weightGrams: 1200, birdCount: 11 },
    { weightGrams: 1220, birdCount: 16 },
    { weightGrams: 1240, birdCount: 21 },
    { weightGrams: 1260, birdCount: 23 },
    { weightGrams: 1280, birdCount: 14 },
    { weightGrams: 1300, birdCount: 8 },
    { weightGrams: 1320, birdCount: 4 },
    { weightGrams: 1340, birdCount: 2 },
  ];
  const statsW12 = calculateUniformity(week12Tallies);
  const alertsW12 = calculatePerformanceAlerts({
    actualAvgWeight: statsW12.averageWeight,
    targetWeight: 1260,
    standardFeedGrams: 55,
    uniformityPercent: statsW12.uniformityPercent,
    ageWeeks: 12,
  });

  const session1 = await prisma.weighingSession.create({
    data: {
      id: 'sess-pen1a-w12',
      penId: pen1a.id,
      flockId: flock1.id,
      ageWeeks: 12,
      weighDate: new Date('2026-09-07'),
      sampleSize: statsW12.totalBirds,
      actualAvgWeight: statsW12.averageWeight,
      targetWeight: 1260,
      uniformityPercent: statsW12.uniformityPercent,
      cvPercent: statsW12.cvPercentF,
      stdDev: statsW12.stdDev,
      lightestWeight: statsW12.lightestWeight,
      heaviestWeight: statsW12.heaviestWeight,
      weightRange: statsW12.weightRange,
      fValue: statsW12.fValue,
      underCount: statsW12.underweightBirds,
      uniformCount: statsW12.birdsInUniformRange,
      overCount: statsW12.overweightBirds,
      status: statsW12.status,
      suggestedFeedGrams: alertsW12.suggestedDailyFeed,
      targetFeedGrams: 55,
      weighedBy: 'K. Rajan',
      notes: 'Week 12 weighing - 112 birds sampled. Uniformity 84.8% (Excellent).',
      tallies: {
        create: week12Tallies,
      }
    }
  });

  // Also create in WeighingRecord for backward compatibility
  await prisma.weighingRecord.create({
    data: {
      id: 'rec-w12-demo',
      penId: pen1a.id,
      flockId: flock1.id,
      ageWeeks: 12,
      weighDate: new Date('2026-09-07'),
      targetWeight: 1260,
      actualAvgWeight: statsW12.averageWeight,
      sampleSize: statsW12.totalBirds,
      uniformityPercent: statsW12.uniformityPercent,
      cvPercent: statsW12.cvPercentF,
      stdDev: statsW12.stdDev,
      lightestWeight: statsW12.lightestWeight,
      heaviestWeight: statsW12.heaviestWeight,
      weightRange: statsW12.weightRange,
      fValue: statsW12.fValue,
      underCount: statsW12.underweightBirds,
      uniformCount: statsW12.birdsInUniformRange,
      overCount: statsW12.overweightBirds,
      status: statsW12.status,
      suggestedFeedGrams: alertsW12.suggestedDailyFeed,
      targetFeedGrams: 55,
      weighedBy: 'K. Rajan',
      notes: 'Week 12 weighing - 112 birds weighed. Uniformity 84.8% (Green status).',
      tallies: {
        create: week12Tallies,
      },
    },
  });

  console.log('✅ Seeded demo weighing sessions and tallies');
  console.log('🎉 Database seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
