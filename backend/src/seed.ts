import { prisma } from './db/prisma.js';

const defaultShedWeights = [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1850, 1950, 1985, 1990];
const defaultMaleWeights = [2800, 3000, 3800, 2650, 2950, 2456, 3566, 2800, 3000, 3800];

async function main() {
  console.log('🌱 Checking database for existing farms...');

  try {
    const existingCount = await prisma.farm.count();
    if (existingCount > 0) {
      console.log(`ℹ️ Database already contains ${existingCount} farms. Skipping seed to preserve data.`);
      return;
    }
  } catch (err) {
    console.warn('⚠️ Unable to connect or count farms in DB:', err);
    return;
  }

  console.log('🌱 Seeding initial demo farms (Sai Farm - Unit 1, Green Valley Farm, Salem Breeder Unit)...');

  // Build sheds for Sai Farm Unit 1
  const saiShedsData = [];
  for (let i = 1; i <= 10; i++) {
    const isMale = i === 8;
    const parts = [
      {
        name: 'Part A',
        order: 1,
        lines: {
          create: [
            {
              name: 'Line 1',
              weights: isMale ? defaultMaleWeights : (i === 1 ? defaultShedWeights : [1270, 1290, 1300, 1330, 1370, 1400, 1450]),
            },
          ],
        },
      },
    ];

    if (i === 1) {
      parts.push({
        name: 'Part B',
        order: 2,
        lines: {
          create: [
            {
              name: 'Line 1',
              weights: [1270, 1290, 1300, 1350, 1380, 1400, 1450],
            },
          ],
        },
      });
    }

    saiShedsData.push({
      name: isMale ? `Shed ${i} Male` : `Shed ${i}`,
      type: isMale ? 'Male' : 'Female',
      order: i,
      parts: { create: parts },
    });
  }

  const farm1 = await prisma.farm.create({
    data: {
      name: 'SAI FARM - UNIT 1',
      flockDate: new Date().toISOString().split('T')[0],
      ageWeek: 'W18',
      season: 'Summer',
      sheds: { create: saiShedsData },
    },
  });

  // Green Valley Farm
  const gvShedsData = [];
  for (let i = 1; i <= 10; i++) {
    const isMale = i === 8;
    gvShedsData.push({
      name: isMale ? `Shed ${i} Male` : `Shed ${i}`,
      type: isMale ? 'Male' : 'Female',
      order: i,
      parts: {
        create: [
          {
            name: 'Part A',
            order: 1,
            lines: { create: [{ name: 'Line 1', weights: [] }] },
          },
        ],
      },
    });
  }

  const farm2 = await prisma.farm.create({
    data: {
      name: 'GREEN VALLEY FARM',
      flockDate: new Date().toISOString().split('T')[0],
      ageWeek: 'W16',
      season: 'Summer',
      sheds: { create: gvShedsData },
    },
  });

  // Salem Breeder Unit
  const salemShedsData = [];
  for (let i = 1; i <= 10; i++) {
    const isMale = i === 8;
    salemShedsData.push({
      name: isMale ? `Shed ${i} Male` : `Shed ${i}`,
      type: isMale ? 'Male' : 'Female',
      order: i,
      parts: {
        create: [
          {
            name: 'Part A',
            order: 1,
            lines: { create: [{ name: 'Line 1', weights: [] }] },
          },
        ],
      },
    });
  }

  const farm3 = await prisma.farm.create({
    data: {
      name: 'SALEM BREEDER UNIT',
      flockDate: new Date().toISOString().split('T')[0],
      ageWeek: 'W20',
      season: 'Winter',
      sheds: { create: salemShedsData },
    },
  });

  console.log(`✅ Seeded 3 farms successfully: ${farm1.name}, ${farm2.name}, ${farm3.name}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
