import { prisma } from './db/prisma.js';
import { hashPassword } from './services/authService.js';

const defaultShedWeights = [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1850, 1950, 1985, 1990];
const defaultMaleWeights = [2800, 3000, 3800, 2650, 2950, 2456, 3566, 2800, 3000, 3800];

export async function seedUsersIfEmpty(): Promise<void> {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`ℹ️ [SEED] Database already contains ${userCount} users. Skipping user seed.`);
    return;
  }

  console.log('🌱 [SEED] Seeding baseline authentication accounts...');
  await prisma.user.createMany({
    data: [
      {
        username: 'admin',
        name: 'System Administrator',
        email: 'admin@farm.local',
        password: hashPassword('Admin@123'),
        role: 'Admin',
        status: 'ACTIVE',
        assignedFarms: ['*'],
      },
      {
        username: 'manager',
        name: 'Flock Manager',
        email: 'manager@farm.local',
        password: hashPassword('Manager@123'),
        role: 'Manager',
        status: 'ACTIVE',
        assignedFarms: ['*'],
      },
      {
        username: 'supervisor',
        name: 'Suresh Kumar',
        email: 'suresh@farm.local',
        password: hashPassword('Super@123'),
        role: 'Supervisor',
        status: 'ACTIVE',
        assignedFarms: ['SAI FARM - UNIT 1', 'farm-sai-1', 'Sai Farm Unit-2'],
      },
      {
        username: 'incharge',
        name: 'Ramesh Patel',
        email: 'ramesh@farm.local',
        password: hashPassword('Incharge@123'),
        role: 'In-Charge',
        status: 'ACTIVE',
        assignedFarms: ['GREEN VALLEY FARM', 'farm-green-valley', 'Zara Unit-I', 'farm-zara-1'],
      },
    ],
  });
  console.log('✅ [SEED] Initial accounts created: admin, manager, supervisor, incharge.');
}

export async function seedFarmsIfEmpty(): Promise<void> {
  const existingCount = await prisma.farm.count();
  if (existingCount > 0) {
    console.log(`ℹ️ [SEED] Database already contains ${existingCount} farms. Skipping farm seed.`);
    return;
  }

  console.log('🌱 [SEED] Seeding initial standard farms (Sai Farm - Unit 1, Green Valley Farm, Salem Breeder Unit)...');

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

  console.log(`✅ [SEED] Seeded 3 baseline farms: ${farm1.name}, ${farm2.name}, ${farm3.name}`);
}

export async function seedDatabase(farmCount?: number, userCount?: number): Promise<void> {
  const users = userCount ?? await prisma.user.count();
  if (users === 0) {
    await seedUsersIfEmpty();
  }

  const farms = farmCount ?? await prisma.farm.count();
  if (farms === 0) {
    await seedFarmsIfEmpty();
  }
}

// Standalone execution
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('seed.js') || 
  process.argv[1].endsWith('seed.ts')
);

if (isDirectRun) {
  seedDatabase()
    .then(() => {
      console.log('🏁 [SEED] Seeding finished successfully.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('❌ [SEED] Seeding failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
