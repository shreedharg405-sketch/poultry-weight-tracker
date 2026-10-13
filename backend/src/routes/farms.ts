import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import crypto from 'crypto';

export const farmRouter = Router();

// Track whether Prisma database connection is available
let dbAvailable = true;

async function checkDb(): Promise<boolean> {
  if (!dbAvailable) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    dbAvailable = false;
    console.warn('⚠️ PostgreSQL unreachable, switching to in-memory cloud simulation store.');
    return false;
  }
}

// In-Memory Fallback Store (Used during local dev without PostgreSQL)
interface MemLine {
  id: string;
  partId: string;
  name: string;
  weights: number[];
}

interface MemPart {
  id: string;
  shedId: string;
  name: string;
  order: number;
  lines: MemLine[];
}

interface MemShed {
  id: string;
  farmId: string;
  name: string;
  type: 'Female' | 'Male';
  order: number;
  parts: MemPart[];
}

interface MemFarm {
  id: string;
  name: string;
  flockDate: string;
  ageWeek: string;
  season: string;
  updatedAt: Date;
  createdAt: Date;
  sheds: MemShed[];
}

export interface MemUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  createdAt: Date;
}

export interface MemActivityLog {
  id: string;
  farmId: string;
  farmName: string;
  userId?: string | null;
  userName: string;
  action: string;
  shedName?: string;
  partName?: string;
  lineName?: string;
  sampleCount: number;
  avgWeight?: number;
  status: string; // 'LIVE' | 'COMPLETED'
  createdAt: Date;
}

const defaultShedWeights = [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1850, 1950, 1985, 1990];
const defaultMaleWeights = [2800, 3000, 3800, 2650, 2950, 2456, 3566, 2800, 3000, 3800];

function generateDefaultSheds(farmId: string): MemShed[] {
  const sheds: MemShed[] = [];
  for (let i = 1; i <= 10; i++) {
    const isMale = i === 8;
    const shedId = `shed-${farmId}-${i}`;
    const partAId = `part-${shedId}-a`;
    const line1Id = `line-${partAId}-1`;

    const parts: MemPart[] = [
      {
        id: partAId,
        shedId,
        name: 'Part A',
        order: 1,
        lines: [
          {
            id: line1Id,
            partId: partAId,
            name: 'Line 1',
            weights: isMale ? [...defaultMaleWeights] : (i === 1 ? [...defaultShedWeights] : [1270, 1290, 1300, 1330, 1370, 1400, 1450]),
          },
        ],
      },
    ];

    if (i === 1) {
      const partBId = `part-${shedId}-b`;
      parts.push({
        id: partBId,
        shedId,
        name: 'Part B',
        order: 2,
        lines: [
          {
            id: `line-${partBId}-1`,
            partId: partBId,
            name: 'Line 1',
            weights: [1270, 1290, 1300, 1350, 1380, 1400, 1450],
          },
        ],
      });
    }

    sheds.push({
      id: shedId,
      farmId,
      name: isMale ? `Shed ${i} Male` : `Shed ${i}`,
      type: isMale ? 'Male' : 'Female',
      order: i,
      parts,
    });
  }
  return sheds;
}

const memoryFarms: MemFarm[] = [
  {
    id: 'farm-sai-1',
    name: 'SAI FARM - UNIT 1',
    flockDate: new Date().toISOString().split('T')[0],
    ageWeek: 'W18',
    season: 'Summer',
    updatedAt: new Date(),
    createdAt: new Date(),
    sheds: generateDefaultSheds('farm-sai-1'),
  },
  {
    id: 'farm-green-valley',
    name: 'GREEN VALLEY FARM',
    flockDate: new Date().toISOString().split('T')[0],
    ageWeek: 'W16',
    season: 'Summer',
    updatedAt: new Date(Date.now() - 3600000),
    createdAt: new Date(Date.now() - 3600000),
    sheds: generateDefaultSheds('farm-green-valley'),
  },
  {
    id: 'farm-salem-breeder',
    name: 'SALEM BREEDER UNIT',
    flockDate: new Date().toISOString().split('T')[0],
    ageWeek: 'W20',
    season: 'Winter',
    updatedAt: new Date(Date.now() - 7200000),
    createdAt: new Date(Date.now() - 7200000),
    sheds: generateDefaultSheds('farm-salem-breeder'),
  },
];

export const memoryUsers: MemUser[] = [
  {
    id: 'u-suresh-1',
    name: 'Suresh Kumar',
    email: 'suresh@farm.com',
    password: 'password123',
    role: 'Weighing Supervisor',
    createdAt: new Date(),
  },
  {
    id: 'u-ramesh-2',
    name: 'Ramesh Patel',
    email: 'ramesh@farm.com',
    password: 'password123',
    role: 'Farm Manager',
    createdAt: new Date(),
  },
];

export const memoryLogs: MemActivityLog[] = [
  {
    id: 'log-1',
    farmId: 'farm-sai-1',
    farmName: 'SAI FARM - UNIT 1',
    userName: 'Suresh Kumar',
    action: 'Weighed 15 Birds in Shed 1 › Part A › Line 1',
    shedName: 'Shed 1',
    partName: 'Part A',
    lineName: 'Line 1',
    sampleCount: 15,
    avgWeight: 1420,
    status: 'LIVE',
    createdAt: new Date(Date.now() - 1000 * 30), // 30 sec ago
  },
  {
    id: 'log-2',
    farmId: 'farm-sai-1',
    farmName: 'SAI FARM - UNIT 1',
    userName: 'Ramesh Patel',
    action: 'Weighed 8 Birds in Shed 8 Male › Part A › Line 1',
    shedName: 'Shed 8 Male',
    partName: 'Part A',
    lineName: 'Line 1',
    sampleCount: 8,
    avgWeight: 3120,
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 1000 * 60 * 15), // 15 mins ago
  },
  {
    id: 'log-3',
    farmId: 'farm-green-valley',
    farmName: 'GREEN VALLEY FARM',
    userName: 'Anand M.',
    action: 'Weighed 12 Birds in Shed 2 › Part B › Line 1',
    shedName: 'Shed 2',
    partName: 'Part B',
    lineName: 'Line 1',
    sampleCount: 12,
    avgWeight: 1395,
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 1000 * 60 * 45), // 45 mins ago
  },
];

// Helper to touch farm updatedAt
async function touchFarm(farmId: string) {
  const now = new Date();
  if (await checkDb()) {
    try {
      await prisma.farm.update({
        where: { id: farmId },
        data: { updatedAt: now },
      });
      return;
    } catch (e) {
      console.warn('touchFarm DB error:', e);
    }
  }
  const f = memoryFarms.find(farm => farm.id === farmId);
  if (f) f.updatedAt = now;
}

// --------------------------------------------------------------------------
// 1. GET /api/farms - Fetch all farms summaries
// --------------------------------------------------------------------------
farmRouter.get('/farms', async (_req: Request, res: Response) => {
  try {
    if (await checkDb()) {
      const farms = await prisma.farm.findMany({
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { sheds: true } },
        },
      });
      return res.json(farms);
    }
  } catch (err) {
    console.warn('Prisma get /farms error, fallback to memory:', err);
  }

  const summaries = memoryFarms
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(f => ({
      id: f.id,
      name: f.name,
      flockDate: f.flockDate,
      ageWeek: f.ageWeek,
      season: f.season,
      updatedAt: f.updatedAt,
      createdAt: f.createdAt,
      _count: { sheds: f.sheds.length },
    }));
  return res.json(summaries);
});

// --------------------------------------------------------------------------
// 2. POST /api/farms - Create new farm with default sheds
// --------------------------------------------------------------------------
farmRouter.post('/farms', async (req: Request, res: Response) => {
  const { name, flockDate, ageWeek, season } = req.body;
  const farmName = name?.trim() || 'New Farm Unit';
  const farmDate = flockDate || new Date().toISOString().split('T')[0];
  const farmAge = ageWeek || 'W18';
  const farmSeason = season || 'Summer';
  const farmId = crypto.randomUUID();

  try {
    if (await checkDb()) {
      // Build 10 default sheds
      const shedsData = [];
      for (let i = 1; i <= 10; i++) {
        const isMale = i === 8;
        shedsData.push({
          name: isMale ? `Shed ${i} Male` : `Shed ${i}`,
          type: isMale ? 'Male' : 'Female',
          order: i,
          parts: {
            create: [
              {
                name: 'Part A',
                order: 1,
                lines: {
                  create: [
                    {
                      name: 'Line 1',
                      weights: [],
                    },
                  ],
                },
              },
            ],
          },
        });
      }

      const newFarm = await prisma.farm.create({
        data: {
          id: farmId,
          name: farmName,
          flockDate: farmDate,
          ageWeek: farmAge,
          season: farmSeason,
          sheds: {
            create: shedsData,
          },
        },
        include: {
          sheds: {
            orderBy: { order: 'asc' },
            include: {
              parts: {
                orderBy: { order: 'asc' },
                include: { lines: true },
              },
            },
          },
        },
      });
      return res.status(201).json(newFarm);
    }
  } catch (err) {
    console.warn('Prisma create /farms error, fallback to memory:', err);
  }

  // Memory fallback
  const newMemFarm: MemFarm = {
    id: farmId,
    name: farmName,
    flockDate: farmDate,
    ageWeek: farmAge,
    season: farmSeason,
    createdAt: new Date(),
    updatedAt: new Date(),
    sheds: generateDefaultSheds(farmId).map(s => ({
      ...s,
      parts: s.parts.map(p => ({
        ...p,
        lines: p.lines.map(l => ({ ...l, weights: [] })),
      })),
    })),
  };
  memoryFarms.unshift(newMemFarm);
  return res.status(201).json(newMemFarm);
});

// --------------------------------------------------------------------------
// 3. GET /api/farms/:id - Get full farm details with hierarchy
// --------------------------------------------------------------------------
farmRouter.get('/farms/:id', async (req: Request, res: Response) => {
  const farmId = req.params.id;
  try {
    if (await checkDb()) {
      const farm = await prisma.farm.findUnique({
        where: { id: farmId },
        include: {
          sheds: {
            orderBy: { order: 'asc' },
            include: {
              parts: {
                orderBy: { order: 'asc' },
                include: { lines: true },
              },
            },
          },
        },
      });
      if (farm) return res.json(farm);
    }
  } catch (err) {
    console.warn('Prisma get /farms/:id error:', err);
  }

  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) {
    return res.status(404).json({ error: 'Farm not found' });
  }
  return res.json(memFarm);
});

// --------------------------------------------------------------------------
// 4. PUT /api/farms/:id/details - Update farm metadata
// --------------------------------------------------------------------------
farmRouter.put('/farms/:id/details', async (req: Request, res: Response) => {
  const farmId = req.params.id;
  const { name, flockDate, ageWeek, season } = req.body;
  const now = new Date();

  try {
    if (await checkDb()) {
      const updated = await prisma.farm.update({
        where: { id: farmId },
        data: {
          ...(name && { name: name.trim() }),
          ...(flockDate && { flockDate }),
          ...(ageWeek && { ageWeek }),
          ...(season && { season }),
          updatedAt: now,
        },
      });
      return res.json(updated);
    }
  } catch (err) {
    console.warn('Prisma update details error:', err);
  }

  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });

  if (name) memFarm.name = name.trim();
  if (flockDate) memFarm.flockDate = flockDate;
  if (ageWeek) memFarm.ageWeek = ageWeek;
  if (season) memFarm.season = season;
  memFarm.updatedAt = now;

  return res.json(memFarm);
});

// --------------------------------------------------------------------------
// 5. DELETE /api/farms/:id - Delete a farm
// --------------------------------------------------------------------------
farmRouter.delete('/farms/:id', async (req: Request, res: Response) => {
  const farmId = req.params.id;
  try {
    if (await checkDb()) {
      await prisma.farm.delete({ where: { id: farmId } });
      return res.json({ success: true, message: 'Farm deleted' });
    }
  } catch (err) {
    console.warn('Prisma delete farm error:', err);
  }

  const idx = memoryFarms.findIndex(f => f.id === farmId);
  if (idx !== -1) {
    memoryFarms.splice(idx, 1);
    return res.json({ success: true, message: 'Farm deleted' });
  }
  return res.status(404).json({ error: 'Farm not found' });
});

// --------------------------------------------------------------------------
// 6. POST /api/sheds - Add new shed to farm
// --------------------------------------------------------------------------
farmRouter.post('/sheds', async (req: Request, res: Response) => {
  const { farmId, name, type, order } = req.body;
  if (!farmId || !name) return res.status(400).json({ error: 'farmId and name required' });

  const shedId = crypto.randomUUID();
  const shedOrder = order || 99;
  const shedType = type === 'Male' ? 'Male' : 'Female';

  try {
    if (await checkDb()) {
      const newShed = await prisma.shed.create({
        data: {
          id: shedId,
          farmId,
          name: name.trim(),
          type: shedType,
          order: shedOrder,
          parts: {
            create: [
              {
                name: 'Part A',
                order: 1,
                lines: { create: [{ name: 'Line 1', weights: [] }] },
              },
            ],
          },
        },
        include: {
          parts: { include: { lines: true } },
        },
      });
      await touchFarm(farmId);
      return res.status(201).json(newShed);
    }
  } catch (err) {
    console.warn('Prisma create shed error:', err);
  }

  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });

  const partId = `part-${Date.now()}`;
  const newMemShed: MemShed = {
    id: shedId,
    farmId,
    name: name.trim(),
    type: shedType,
    order: shedOrder,
    parts: [
      {
        id: partId,
        shedId,
        name: 'Part A',
        order: 1,
        lines: [{ id: `line-${Date.now()}`, partId, name: 'Line 1', weights: [] }],
      },
    ],
  };
  memFarm.sheds.push(newMemShed);
  memFarm.updatedAt = new Date();
  return res.status(201).json(newMemShed);
});

// --------------------------------------------------------------------------
// 7. DELETE /api/sheds/:shedId - Delete shed
// --------------------------------------------------------------------------
farmRouter.delete('/sheds/:shedId', async (req: Request, res: Response) => {
  const shedId = req.params.shedId;
  try {
    if (await checkDb()) {
      const shed = await prisma.shed.findUnique({ where: { id: shedId } });
      if (shed) {
        await prisma.shed.delete({ where: { id: shedId } });
        await touchFarm(shed.farmId);
        return res.json({ success: true });
      }
    }
  } catch (err) {
    console.warn('Prisma delete shed error:', err);
  }

  for (const farm of memoryFarms) {
    const sIdx = farm.sheds.findIndex(s => s.id === shedId);
    if (sIdx !== -1) {
      farm.sheds.splice(sIdx, 1);
      farm.updatedAt = new Date();
      return res.json({ success: true });
    }
  }
  return res.status(404).json({ error: 'Shed not found' });
});

// --------------------------------------------------------------------------
// 8. PUT /api/sheds/:shedId - Edit shed name/type
// --------------------------------------------------------------------------
farmRouter.put('/sheds/:shedId', async (req: Request, res: Response) => {
  const shedId = req.params.shedId;
  const { name, type } = req.body;
  try {
    if (await checkDb()) {
      const updated = await prisma.shed.update({
        where: { id: shedId },
        data: {
          ...(name && { name: name.trim() }),
          ...(type && { type }),
        },
      });
      await touchFarm(updated.farmId);
      return res.json(updated);
    }
  } catch (err) {
    console.warn('Prisma update shed error:', err);
  }

  for (const farm of memoryFarms) {
    const s = farm.sheds.find(shed => shed.id === shedId);
    if (s) {
      if (name) s.name = name.trim();
      if (type) s.type = type;
      farm.updatedAt = new Date();
      return res.json(s);
    }
  }
  return res.status(404).json({ error: 'Shed not found' });
});

// --------------------------------------------------------------------------
// 9. POST /api/parts - Add part to shed
// --------------------------------------------------------------------------
farmRouter.post('/parts', async (req: Request, res: Response) => {
  const { shedId, name, order } = req.body;
  if (!shedId || !name) return res.status(400).json({ error: 'shedId and name required' });
  const partId = crypto.randomUUID();

  try {
    if (await checkDb()) {
      const newPart = await prisma.part.create({
        data: {
          id: partId,
          shedId,
          name: name.trim(),
          order: order || 1,
          lines: {
            create: [{ name: 'Line 1', weights: [] }],
          },
        },
        include: { lines: true, shed: true },
      });
      await touchFarm(newPart.shed.farmId);
      return res.status(201).json(newPart);
    }
  } catch (err) {
    console.warn('Prisma create part error:', err);
  }

  for (const farm of memoryFarms) {
    const s = farm.sheds.find(shed => shed.id === shedId);
    if (s) {
      const newMemPart: MemPart = {
        id: partId,
        shedId,
        name: name.trim(),
        order: order || s.parts.length + 1,
        lines: [{ id: `line-${Date.now()}`, partId, name: 'Line 1', weights: [] }],
      };
      s.parts.push(newMemPart);
      farm.updatedAt = new Date();
      return res.status(201).json(newMemPart);
    }
  }
  return res.status(404).json({ error: 'Shed not found' });
});

// --------------------------------------------------------------------------
// 10. DELETE /api/parts/:partId - Delete part
// --------------------------------------------------------------------------
farmRouter.delete('/parts/:partId', async (req: Request, res: Response) => {
  const partId = req.params.partId;
  try {
    if (await checkDb()) {
      const part = await prisma.part.findUnique({
        where: { id: partId },
        include: { shed: true },
      });
      if (part) {
        await prisma.part.delete({ where: { id: partId } });
        await touchFarm(part.shed.farmId);
        return res.json({ success: true });
      }
    }
  } catch (err) {
    console.warn('Prisma delete part error:', err);
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      const pIdx = shed.parts.findIndex(p => p.id === partId);
      if (pIdx !== -1) {
        shed.parts.splice(pIdx, 1);
        farm.updatedAt = new Date();
        return res.json({ success: true });
      }
    }
  }
  return res.status(404).json({ error: 'Part not found' });
});

// --------------------------------------------------------------------------
// 11. PUT /api/parts/:partId - Rename part
// --------------------------------------------------------------------------
farmRouter.put('/parts/:partId', async (req: Request, res: Response) => {
  const partId = req.params.partId;
  const { name } = req.body;
  try {
    if (await checkDb()) {
      const updated = await prisma.part.update({
        where: { id: partId },
        data: { name: name?.trim() },
        include: { shed: true },
      });
      await touchFarm(updated.shed.farmId);
      return res.json(updated);
    }
  } catch (err) {
    console.warn('Prisma rename part error:', err);
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      const p = shed.parts.find(part => part.id === partId);
      if (p) {
        p.name = name?.trim() || p.name;
        farm.updatedAt = new Date();
        return res.json(p);
      }
    }
  }
  return res.status(404).json({ error: 'Part not found' });
});

// --------------------------------------------------------------------------
// 12. POST /api/lines - Add line to part
// --------------------------------------------------------------------------
farmRouter.post('/lines', async (req: Request, res: Response) => {
  const { partId, name } = req.body;
  if (!partId) return res.status(400).json({ error: 'partId required' });
  const lineId = crypto.randomUUID();

  try {
    if (await checkDb()) {
      const newLine = await prisma.line.create({
        data: {
          id: lineId,
          partId,
          name: name?.trim() || 'Line',
          weights: [],
        },
        include: { part: { include: { shed: true } } },
      });
      await touchFarm(newLine.part.shed.farmId);
      return res.status(201).json(newLine);
    }
  } catch (err) {
    console.warn('Prisma create line error:', err);
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      const p = shed.parts.find(part => part.id === partId);
      if (p) {
        const newLine: MemLine = {
          id: lineId,
          partId,
          name: name?.trim() || `Line ${p.lines.length + 1}`,
          weights: [],
        };
        p.lines.push(newLine);
        farm.updatedAt = new Date();
        return res.status(201).json(newLine);
      }
    }
  }
  return res.status(404).json({ error: 'Part not found' });
});

// --------------------------------------------------------------------------
// 13. DELETE /api/lines/:lineId - Delete line
// --------------------------------------------------------------------------
farmRouter.delete('/lines/:lineId', async (req: Request, res: Response) => {
  const lineId = req.params.lineId;
  try {
    if (await checkDb()) {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: true } } },
      });
      if (line) {
        await prisma.line.delete({ where: { id: lineId } });
        await touchFarm(line.part.shed.farmId);
        return res.json({ success: true });
      }
    }
  } catch (err) {
    console.warn('Prisma delete line error:', err);
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      for (const part of shed.parts) {
        const lIdx = part.lines.findIndex(l => String(l.id) === String(lineId));
        if (lIdx !== -1) {
          part.lines.splice(lIdx, 1);
          farm.updatedAt = new Date();
          return res.json({ success: true });
        }
      }
    }
  }
  return res.status(404).json({ error: 'Line not found' });
});

// 14. POST /api/lines/:lineId/weight - Push bird weight entry
// --------------------------------------------------------------------------
farmRouter.post('/lines/:lineId/weight', async (req: Request, res: Response) => {
  const lineId = req.params.lineId;
  const weight = parseFloat(req.body.weight);
  const userName = req.body.userName?.trim() || 'Weighing Supervisor';
  const userId = req.body.userId || null;

  if (isNaN(weight) || weight <= 0) {
    return res.status(400).json({ error: 'Valid positive weight required' });
  }

  try {
    if (await checkDb()) {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: { include: { farm: true } } } } },
      });
      if (line) {
        const updated = await prisma.line.update({
          where: { id: lineId },
          data: { weights: { push: weight } },
        });
        await touchFarm(line.part.shed.farmId);

        const newWeights = [...line.weights, weight];
        const sampleCount = newWeights.length;
        const avgWeight = Math.round(newWeights.reduce((a, b) => a + b, 0) / sampleCount);

        try {
          await prisma.activityLog.create({
            data: {
              farmId: line.part.shed.farmId,
              userId: userId,
              userName: userName,
              action: `Weighed Bird #${sampleCount} (${weight}g) in ${line.part.shed.name} › ${line.part.name} › ${line.name}`,
              shedName: line.part.shed.name,
              partName: line.part.name,
              lineName: line.name,
              sampleCount,
              avgWeight,
              status: 'LIVE',
            },
          });
        } catch (logErr) {
          console.warn('Prisma activityLog creation error:', logErr);
        }

        return res.json(updated);
      }
    }
  } catch (err) {
    console.warn('Prisma add weight error:', err);
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      for (const part of shed.parts) {
        const l = part.lines.find(line => String(line.id) === String(lineId));
        if (l) {
          l.weights.push(weight);
          farm.updatedAt = new Date();

          const sampleCount = l.weights.length;
          const avgWeight = Math.round(l.weights.reduce((a, b) => a + b, 0) / sampleCount);

          const memLog: MemActivityLog = {
            id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            farmId: farm.id,
            farmName: farm.name,
            userId,
            userName,
            action: `Weighed Bird #${sampleCount} (${weight}g) in ${shed.name} › ${part.name} › ${l.name}`,
            shedName: shed.name,
            partName: part.name,
            lineName: l.name,
            sampleCount,
            avgWeight,
            status: 'LIVE',
            createdAt: new Date(),
          };
          memoryLogs.unshift(memLog);
          if (memoryLogs.length > 100) memoryLogs.pop();

          return res.json(l);
        }
      }
    }
  }
  return res.status(404).json({ error: 'Line not found' });
});

// --------------------------------------------------------------------------
// 15. DELETE /api/lines/:lineId/weight/:index - Delete weight entry by index
// --------------------------------------------------------------------------
farmRouter.delete('/lines/:lineId/weight/:index', async (req: Request, res: Response) => {
  const lineId = req.params.lineId;
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0) {
    return res.status(400).json({ error: 'Valid index required' });
  }

  try {
    if (await checkDb()) {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: true } } },
      });
      if (line && index < line.weights.length) {
        const updatedWeights = [...line.weights];
        updatedWeights.splice(index, 1);
        const updated = await prisma.line.update({
          where: { id: lineId },
          data: { weights: { set: updatedWeights } },
        });
        await touchFarm(line.part.shed.farmId);
        return res.json(updated);
      }
    }
  } catch (err) {
    console.warn('Prisma delete weight error:', err);
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      for (const part of shed.parts) {
        const l = part.lines.find(line => String(line.id) === String(lineId));
        if (l && index < l.weights.length) {
          l.weights.splice(index, 1);
          farm.updatedAt = new Date();
          return res.json(l);
        }
      }
    }
  }
  return res.status(404).json({ error: 'Line or weight index not found' });
});

// --------------------------------------------------------------------------
// 16. POST /api/lines/:lineId/clear - Clear all weights in a line
// --------------------------------------------------------------------------
farmRouter.post('/lines/:lineId/clear', async (req: Request, res: Response) => {
  const lineId = req.params.lineId;
  try {
    if (await checkDb()) {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: true } } },
      });
      if (line) {
        const updated = await prisma.line.update({
          where: { id: lineId },
          data: { weights: { set: [] } },
        });
        await touchFarm(line.part.shed.farmId);
        return res.json(updated);
      }
    }
  } catch (err) {
    console.warn('Prisma clear line error:', err);
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      for (const part of shed.parts) {
        const l = part.lines.find(line => String(line.id) === String(lineId));
        if (l) {
          l.weights = [];
          farm.updatedAt = new Date();
          return res.json(l);
        }
      }
    }
  }
  return res.status(404).json({ error: 'Line not found' });
});

// --------------------------------------------------------------------------
// 17. PUT /api/farms/:id/sync - Full farm sync (Replaces/updates full hierarchy)
// --------------------------------------------------------------------------
farmRouter.put('/farms/:id/sync', async (req: Request, res: Response) => {
  const farmId = req.params.id;
  const { sheds, name, flockDate, ageWeek, season } = req.body;
  const now = new Date();

  try {
    if (await checkDb()) {
      // Upsert farm
      const farm = await prisma.farm.upsert({
        where: { id: farmId },
        update: {
          ...(name && { name: name.trim() }),
          ...(flockDate && { flockDate }),
          ...(ageWeek && { ageWeek }),
          ...(season && { season }),
          updatedAt: now,
        },
        create: {
          id: farmId,
          name: name?.trim() || 'Synced Farm',
          flockDate: flockDate || new Date().toISOString().split('T')[0],
          ageWeek: ageWeek || 'W18',
          season: season || 'Summer',
          updatedAt: now,
        },
      });

      if (Array.isArray(sheds)) {
        // Delete old sheds and insert fresh hierarchy to ensure 1:1 cloud sync
        await prisma.shed.deleteMany({ where: { farmId } });

        for (let sIdx = 0; sIdx < sheds.length; sIdx++) {
          const s = sheds[sIdx];
          const shed = await prisma.shed.create({
            data: {
              id: s.id || crypto.randomUUID(),
              farmId,
              name: s.name,
              type: s.type || 'Female',
              order: sIdx + 1,
            },
          });

          if (Array.isArray(s.parts)) {
            for (let pIdx = 0; pIdx < s.parts.length; pIdx++) {
              const p = s.parts[pIdx];
              const part = await prisma.part.create({
                data: {
                  id: p.id || crypto.randomUUID(),
                  shedId: shed.id,
                  name: p.name,
                  order: pIdx + 1,
                },
              });

              if (Array.isArray(p.lines)) {
                for (const l of p.lines) {
                  await prisma.line.create({
                    data: {
                      id: String(l.id || crypto.randomUUID()),
                      partId: part.id,
                      name: l.name,
                      weights: l.weights || [],
                    },
                  });
                }
              }
            }
          }
        }
      }

      const refreshed = await prisma.farm.findUnique({
        where: { id: farmId },
        include: {
          sheds: {
            orderBy: { order: 'asc' },
            include: {
              parts: {
                orderBy: { order: 'asc' },
                include: { lines: true },
              },
            },
          },
        },
      });
      return res.json(refreshed || farm);
    }
  } catch (err) {
    console.warn('Prisma full sync error, fallback to memory:', err);
  }

  let memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) {
    memFarm = {
      id: farmId,
      name: name?.trim() || 'Synced Farm',
      flockDate: flockDate || new Date().toISOString().split('T')[0],
      ageWeek: ageWeek || 'W18',
      season: season || 'Summer',
      updatedAt: now,
      createdAt: now,
      sheds: sheds || generateDefaultSheds(farmId),
    };
    memoryFarms.unshift(memFarm);
  } else {
    if (name) memFarm.name = name.trim();
    if (flockDate) memFarm.flockDate = flockDate;
    if (ageWeek) memFarm.ageWeek = ageWeek;
    if (season) memFarm.season = season;
    if (Array.isArray(sheds)) memFarm.sheds = sheds;
    memFarm.updatedAt = now;
  }

  return res.json(memFarm);
});

// --------------------------------------------------------------------------
// 18. POST /api/auth/register - Register new user
// --------------------------------------------------------------------------
farmRouter.post('/auth/register', async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const userName = name?.trim() || cleanEmail.split('@')[0];
  const userRole = role?.trim() || 'Weighing Supervisor';
  const userId = crypto.randomUUID();

  try {
    if (await checkDb()) {
      const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (existing) {
        return res.status(409).json({ error: 'User with this email already exists' });
      }

      const user = await prisma.user.create({
        data: {
          id: userId,
          name: userName,
          email: cleanEmail,
          password: String(password),
          role: userRole,
        },
      });

      return res.status(201).json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt },
      });
    }
  } catch (err) {
    console.warn('Prisma auth register error, fallback to memory:', err);
  }

  const existingMem = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
  if (existingMem) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  const newMemUser: MemUser = {
    id: userId,
    name: userName,
    email: cleanEmail,
    password: String(password),
    role: userRole,
    createdAt: new Date(),
  };
  memoryUsers.push(newMemUser);

  return res.status(201).json({
    user: { id: newMemUser.id, name: newMemUser.name, email: newMemUser.email, role: newMemUser.role, createdAt: newMemUser.createdAt },
  });
});

// --------------------------------------------------------------------------
// 19. POST /api/auth/login - User Sign In (with auto-provision fallback)
// --------------------------------------------------------------------------
farmRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();

  try {
    if (await checkDb()) {
      let user = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (user) {
        if (user.password !== String(password)) {
          return res.status(401).json({ error: 'Invalid password' });
        }
        return res.json({
          user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt },
        });
      }

      // Auto-provision user account for streamlined onboarding
      user = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          name: cleanEmail.split('@')[0],
          email: cleanEmail,
          password: String(password),
          role: 'Weighing Supervisor',
        },
      });

      return res.json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt },
      });
    }
  } catch (err) {
    console.warn('Prisma auth login error, fallback to memory:', err);
  }

  let memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
  if (memUser) {
    if (memUser.password !== String(password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    return res.json({
      user: { id: memUser.id, name: memUser.name, email: memUser.email, role: memUser.role, createdAt: memUser.createdAt },
    });
  }

  const newMemUser: MemUser = {
    id: `u-${Date.now()}`,
    name: cleanEmail.split('@')[0],
    email: cleanEmail,
    password: String(password),
    role: 'Weighing Supervisor',
    createdAt: new Date(),
  };
  memoryUsers.push(newMemUser);

  return res.json({
    user: { id: newMemUser.id, name: newMemUser.name, email: newMemUser.email, role: newMemUser.role, createdAt: newMemUser.createdAt },
  });
});

// --------------------------------------------------------------------------
// 20. GET /api/auth/users - List users
// --------------------------------------------------------------------------
farmRouter.get('/auth/users', async (_req: Request, res: Response) => {
  try {
    if (await checkDb()) {
      const users = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(users);
    }
  } catch (err) {
    console.warn('Prisma get users error:', err);
  }

  return res.json(memoryUsers.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt })));
});

// --------------------------------------------------------------------------
// 21. GET /api/logs - Activity update history logs
// --------------------------------------------------------------------------
farmRouter.get('/logs', async (req: Request, res: Response) => {
  const farmId = req.query.farmId as string | undefined;
  const liveOnly = req.query.liveOnly === 'true';
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);

  const now = Date.now();

  try {
    if (await checkDb()) {
      const whereClause: any = {};
      if (farmId) whereClause.farmId = farmId;
      if (liveOnly) {
        whereClause.createdAt = { gte: new Date(now - 120 * 1000) };
      }

      const logs = await prisma.activityLog.findMany({
        where: whereClause,
        include: { farm: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const formatted = logs.map(l => {
        const ageMs = now - new Date(l.createdAt).getTime();
        const isLive = ageMs < 120 * 1000 || l.status === 'LIVE';
        return {
          id: l.id,
          farmId: l.farmId,
          farmName: l.farm?.name || 'Farm',
          userId: l.userId,
          userName: l.userName,
          action: l.action,
          shedName: l.shedName || '',
          partName: l.partName || '',
          lineName: l.lineName || '',
          sampleCount: l.sampleCount,
          avgWeight: l.avgWeight || 0,
          status: isLive ? 'LIVE' : l.status,
          timestamp: l.createdAt.toISOString(),
          isLive,
        };
      });

      return res.json(formatted);
    }
  } catch (err) {
    console.warn('Prisma get logs error, fallback to memory:', err);
  }

  let list = memoryLogs.slice();
  if (farmId) list = list.filter(l => l.farmId === farmId);
  if (liveOnly) {
    list = list.filter(l => (now - new Date(l.createdAt).getTime()) < 120 * 1000 || l.status === 'LIVE');
  }
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const formatted = list.slice(0, limit).map(l => {
    const ageMs = now - new Date(l.createdAt).getTime();
    const isLive = ageMs < 120 * 1000 || l.status === 'LIVE';
    return {
      id: l.id,
      farmId: l.farmId,
      farmName: l.farmName,
      userId: l.userId,
      userName: l.userName,
      action: l.action,
      shedName: l.shedName || '',
      partName: l.partName || '',
      lineName: l.lineName || '',
      sampleCount: l.sampleCount,
      avgWeight: l.avgWeight || 0,
      status: isLive ? 'LIVE' : l.status,
      timestamp: new Date(l.createdAt).toISOString(),
      isLive,
    };
  });

  return res.json(formatted);
});

// --------------------------------------------------------------------------
// 22. POST /api/logs - Create custom activity log entry
// --------------------------------------------------------------------------
farmRouter.post('/logs', async (req: Request, res: Response) => {
  const { farmId, userId, userName, action, shedName, partName, lineName, sampleCount, avgWeight, status } = req.body;
  if (!farmId) return res.status(400).json({ error: 'farmId required' });

  const logId = crypto.randomUUID();
  const logUserName = userName?.trim() || 'Supervisor';
  const logAction = action?.trim() || 'Updated bodyweight';
  const logStatus = status || 'COMPLETED';

  try {
    if (await checkDb()) {
      const log = await prisma.activityLog.create({
        data: {
          id: logId,
          farmId,
          userId: userId || null,
          userName: logUserName,
          action: logAction,
          shedName,
          partName,
          lineName,
          sampleCount: sampleCount || 0,
          avgWeight: avgWeight ? parseFloat(avgWeight) : null,
          status: logStatus,
        },
        include: { farm: { select: { name: true } } },
      });

      return res.status(201).json({
        ...log,
        farmName: log.farm.name,
        timestamp: log.createdAt.toISOString(),
        isLive: true,
      });
    }
  } catch (err) {
    console.warn('Prisma create log error:', err);
  }

  const farm = memoryFarms.find(f => f.id === farmId);
  const newMemLog: MemActivityLog = {
    id: logId,
    farmId,
    farmName: farm?.name || 'Farm',
    userId,
    userName: logUserName,
    action: logAction,
    shedName,
    partName,
    lineName,
    sampleCount: sampleCount || 0,
    avgWeight: avgWeight ? parseFloat(avgWeight) : 0,
    status: logStatus,
    createdAt: new Date(),
  };
  memoryLogs.unshift(newMemLog);

  return res.status(201).json({
    ...newMemLog,
    timestamp: newMemLog.createdAt.toISOString(),
    isLive: true,
  });
});
