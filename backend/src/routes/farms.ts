import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import crypto from 'crypto';
import { isPostgresConfigured } from '../db/init.js';
import { 
  hashPassword, 
  verifyPassword, 
  generateToken, 
  verifyToken, 
  checkRateLimit, 
  recordFailedLogin, 
  clearRateLimit 
} from '../services/authService.js';
import { memorySubmissions, memoryBirdWeights } from './submissions.js';

export const farmRouter = Router();

let columnsEnsured = false;
export async function ensureFarmColumns(): Promise<void> {
  if (!isPostgresConfigured() || columnsEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Farm" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE "Farm" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
    `);
    columnsEnsured = true;
    console.log('✅ [DB] Ensured Farm columns (isArchived, archivedAt) exist.');
  } catch (err: any) {
    console.warn('⚠️ [DB] ensureFarmColumns notice:', err?.message || err);
  }
}

farmRouter.use(async (_req, _res, next) => {
  if (!columnsEnsured) {
    await ensureFarmColumns();
  }
  next();
});

export async function checkDb(): Promise<boolean> {
  if (!isPostgresConfigured()) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    await ensureFarmColumns();
    return true;
  } catch (e: any) {
    console.warn('⚠️ [DB] PostgreSQL ping check failed:', e?.message || e);
    return false;
  }
}

// In-Memory Fallback Store (Used ONLY during local dev without PostgreSQL)
export interface MemLine {
  id: string;
  partId: string;
  name: string;
  weights: number[];
}

export interface MemPart {
  id: string;
  shedId: string;
  name: string;
  order: number;
  lines: MemLine[];
}

export interface MemShed {
  id: string;
  farmId: string;
  name: string;
  type: 'Female' | 'Male';
  order: number;
  parts: MemPart[];
}

export interface MemFarm {
  id: string;
  name: string;
  flockDate: string;
  ageWeek: string;
  season: string;
  isArchived?: boolean;
  archivedAt?: Date | null;
  status?: 'DRAFT' | 'COMPLETED';
  progressPercentage?: number;
  audit?: any;
  updatedAt: Date;
  createdAt: Date;
  sheds: MemShed[];
}

export interface MemUser {
  id: string;
  username: string;
  name: string;
  email?: string;
  password: string;
  role: 'Admin' | 'Manager' | 'Supervisor' | 'In-Charge' | string;
  status: 'ACTIVE' | 'INACTIVE';
  assignedFarms: string[];
  createdAt: Date;
  updatedAt?: Date;
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
  status: string;
  createdAt: Date;
}

export const memoryFarms: MemFarm[] = [];

export const memoryUsers: MemUser[] = [
  {
    id: 'u-admin-1',
    username: 'admin',
    name: 'System Administrator',
    email: 'admin@farm.local',
    password: hashPassword('Admin@123'),
    role: 'Admin',
    status: 'ACTIVE',
    assignedFarms: ['*'],
    createdAt: new Date(),
  },
  {
    id: 'u-manager-1',
    username: 'manager',
    name: 'Flock Manager',
    email: 'manager@farm.local',
    password: hashPassword('Manager@123'),
    role: 'Manager',
    status: 'ACTIVE',
    assignedFarms: ['*'],
    createdAt: new Date(),
  },
  {
    id: 'u-supervisor-1',
    username: 'supervisor',
    name: 'Suresh Kumar',
    email: 'suresh@farm.local',
    password: hashPassword('Super@123'),
    role: 'Supervisor',
    status: 'ACTIVE',
    assignedFarms: ['SAI FARM - UNIT 1', 'farm-sai-1', 'Sai Farm Unit-2'],
    createdAt: new Date(),
  },
  {
    id: 'u-incharge-1',
    username: 'incharge',
    name: 'Ramesh Patel',
    email: 'ramesh@farm.local',
    password: hashPassword('Incharge@123'),
    role: 'In-Charge',
    status: 'ACTIVE',
    assignedFarms: ['GREEN VALLEY FARM', 'farm-green-valley', 'Zara Unit-I', 'farm-zara-1'],
    createdAt: new Date(),
  },
];

export const memoryLogs: MemActivityLog[] = [
  {
    id: 'log-1',
    farmId: 'farm-sai-1',
    farmName: 'SAI FARM - UNIT 1',
    userName: 'Suresh Kumar (Weighing Supervisor)',
    action: 'Batch Weighing Submitted • 240 Birds (♀ Act: 1420g, ♂ Act: 3120g)',
    sampleCount: 240,
    avgWeight: 1420,
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 1000 * 60 * 30),
  },
  {
    id: 'log-2',
    farmId: 'farm-green-valley',
    farmName: 'GREEN VALLEY FARM',
    userName: 'Anand M. (Flock Manager)',
    action: 'Batch Weighing Submitted • 180 Birds (♀ Act: 1395g, ♂ Act: 2980g)',
    sampleCount: 180,
    avgWeight: 1395,
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 1000 * 60 * 120),
  },
];

// Helper to touch farm updatedAt
async function touchFarm(farmId: string) {
  const now = new Date();
  if (isPostgresConfigured()) {
    try {
      await prisma.farm.update({
        where: { id: farmId },
        data: { updatedAt: now },
      });
      return;
    } catch (e) {
      console.warn('touchFarm DB error:', e);
    }
  } else {
    const f = memoryFarms.find(farm => farm.id === farmId);
    if (f) f.updatedAt = now;
  }
}

export async function getAuthUserFromRequest(req: Request): Promise<{ id: string; username: string; role: string; name: string; assignedFarms: string[] } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) return null;

  if (isPostgresConfigured()) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, username: true, role: true, name: true, assignedFarms: true },
      });
      if (dbUser) return dbUser;
    } catch {}
  }

  const memUser = memoryUsers.find(u => u.id === payload.userId || u.username === payload.username);
  if (memUser) {
    return {
      id: memUser.id,
      username: memUser.username,
      role: memUser.role,
      name: memUser.name,
      assignedFarms: memUser.assignedFarms || [],
    };
  }

  return {
    id: payload.userId,
    username: payload.username,
    role: payload.role,
    name: payload.username,
    assignedFarms: [],
  };
}

// --------------------------------------------------------------------------
// 1. GET /api/farms - Fetch all farms summaries with synchronized statuses & operator assignments
// --------------------------------------------------------------------------
farmRouter.get('/farms', async (req: Request, res: Response) => {
  const authUser = await getAuthUserFromRequest(req);
  const includeArchived = req.query.includeArchived === 'true';

  if (isPostgresConfigured()) {
    try {
      const [farms, users, submissions] = await Promise.all([
        prisma.farm.findMany({
          where: includeArchived ? {} : { isArchived: false },
          orderBy: { updatedAt: 'desc' },
          include: {
            _count: { select: { sheds: true, submissions: true } },
          },
        }),
        prisma.user.findMany({
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
            assignedFarms: true,
          }
        }),
        prisma.submission.findMany({
          orderBy: { submittedAt: 'desc' },
          select: {
            id: true,
            farmId: true,
            status: true,
            submittedAt: true,
            submitterName: true,
            submitterRole: true,
            totalBirds: true,
            femaleAvgWeight: true,
            maleAvgWeight: true,
            overallAvgWeight: true,
          }
        })
      ]);

      let filteredFarms = farms;

      // Role-based visibility enforcement (Req 8)
      if (authUser) {
        if (authUser.role === 'Supervisor' || authUser.role === 'In-Charge') {
          const userAssigned = authUser.assignedFarms || [];
          if (userAssigned.length === 0) {
            return res.json([]);
          }
          filteredFarms = farms.filter(f => userAssigned.includes(f.id) || userAssigned.includes(f.name));
        } else if (authUser.role === 'Manager') {
          const userAssigned = authUser.assignedFarms || [];
          if (userAssigned.length > 0 && !userAssigned.includes('*')) {
            filteredFarms = farms.filter(f => userAssigned.includes(f.id) || userAssigned.includes(f.name));
          }
        }
      }

      const summaries = filteredFarms.map(f => {
        // Find assigned field operators for this farm - ONLY eligible field operators (Supervisor, In-Charge, Incharge)
        const assignedMap = new Map<string, string>();
        users
          .filter(u => (u.role === 'Supervisor' || u.role === 'In-Charge' || u.role === 'Incharge') &&
                       (u.assignedFarms || []).some(af => af === f.id || af === f.name))
          .forEach(u => {
            assignedMap.set(u.id, `${u.name} (${u.role})`);
          });
        const assigned = Array.from(assignedMap.values());

        // Find latest submission for this farm
        const latestSub = submissions.find(s => s.farmId === f.id);
        const isCompleted = Boolean(latestSub && latestSub.status === 'COMPLETED');

        return {
          id: f.id,
          name: f.name,
          flockDate: f.flockDate,
          ageWeek: f.ageWeek,
          season: f.season,
          status: isCompleted ? 'COMPLETED' : 'DRAFT',
          submissionCount: f._count.submissions,
          isArchived: f.isArchived,
          archivedAt: f.archivedAt ? f.archivedAt.toISOString() : null,
          assignedUserNames: assigned,
          audit: latestSub ? {
            status: isCompleted ? 'COMPLETED' : 'DRAFT',
            lastSubmittedAt: latestSub.submittedAt ? new Date(latestSub.submittedAt).toISOString() : null,
            lastSubmittedBy: latestSub.submitterName,
            lastSubmittedRole: latestSub.submitterRole,
            submittedBy: latestSub.submitterName,
            submittedRole: latestSub.submitterRole,
            totalBirdsSubmitted: latestSub.totalBirds,
            femaleAvgWeight: latestSub.femaleAvgWeight,
            maleAvgWeight: latestSub.maleAvgWeight,
          } : undefined,
          updatedAt: f.updatedAt,
          createdAt: f.createdAt,
          _count: { sheds: f._count.sheds, submissions: f._count.submissions },
        };
      });

      return res.json(summaries);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL query failed on GET /farms:', err?.message || err);
      if (err?.code === 'P2022' || String(err?.message).includes('isArchived')) {
        try {
          await ensureFarmColumns();
          const retryFarms = await prisma.farm.findMany({
            where: includeArchived ? {} : { isArchived: false },
            orderBy: { updatedAt: 'desc' },
            include: { _count: { select: { sheds: true, submissions: true } } },
          });
          return res.json(retryFarms.map(f => ({
            id: f.id,
            name: f.name,
            flockDate: f.flockDate,
            ageWeek: f.ageWeek,
            season: f.season,
            status: 'DRAFT',
            submissionCount: f._count.submissions,
            isArchived: f.isArchived,
            archivedAt: f.archivedAt ? f.archivedAt.toISOString() : null,
            assignedUserNames: [],
            updatedAt: f.updatedAt,
            createdAt: f.createdAt,
            _count: { sheds: f._count.sheds, submissions: f._count.submissions },
          })));
        } catch (retryErr) {
          console.error('Retry after column migration also failed:', retryErr);
        }
      }
      return res.status(503).json({
        error: 'Database error: Failed to retrieve farms from PostgreSQL database.',
        code: err?.code || 'DB_ERROR',
        details: err?.message || 'Database query failed',
      });
    }
  }

  // Offline / local development in-memory simulation only
  let memFarmsFiltered = memoryFarms;
  if (!includeArchived) {
    memFarmsFiltered = memFarmsFiltered.filter(f => !f.isArchived);
  }

  if (authUser) {
    if (authUser.role === 'Supervisor' || authUser.role === 'In-Charge') {
      const userAssigned = authUser.assignedFarms || [];
      if (userAssigned.length === 0) return res.json([]);
      memFarmsFiltered = memoryFarms.filter(f => userAssigned.includes(f.id) || userAssigned.includes(f.name));
    } else if (authUser.role === 'Manager') {
      const userAssigned = authUser.assignedFarms || [];
      if (userAssigned.length > 0 && !userAssigned.includes('*')) {
        memFarmsFiltered = memoryFarms.filter(f => userAssigned.includes(f.id) || userAssigned.includes(f.name));
      }
    }
  }

  const summaries = memFarmsFiltered
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(f => {
      const assignedMap = new Map<string, string>();
      memoryUsers
        .filter(u => (u.role === 'Supervisor' || u.role === 'In-Charge' || u.role === 'Incharge') &&
                     (u.assignedFarms || []).some(af => af === f.id || af === f.name))
        .forEach(u => {
          assignedMap.set(u.id, `${u.name} (${u.role})`);
        });
      const assigned = Array.from(assignedMap.values());

      const farmSubs = memorySubmissions.filter(s => s.farmId === f.id);
      const latestMemSub = farmSubs[0];
      const isCompleted = Boolean(latestMemSub && latestMemSub.status === 'COMPLETED');

      return {
        id: f.id,
        name: f.name,
        flockDate: f.flockDate,
        ageWeek: f.ageWeek,
        season: f.season,
        status: isCompleted ? 'COMPLETED' : (f.status || 'DRAFT'),
        submissionCount: farmSubs.length,
        isArchived: Boolean(f.isArchived),
        archivedAt: f.archivedAt ? f.archivedAt.toISOString() : null,
        assignedUserNames: assigned,
        audit: latestMemSub ? {
          status: isCompleted ? 'COMPLETED' : 'DRAFT',
          lastSubmittedAt: latestMemSub.submittedAt ? new Date(latestMemSub.submittedAt).toISOString() : null,
          lastSubmittedBy: latestMemSub.submitterName,
          lastSubmittedRole: latestMemSub.submitterRole,
          submittedBy: latestMemSub.submitterName,
          submittedRole: latestMemSub.submitterRole,
          totalBirdsSubmitted: latestMemSub.totalBirds,
          femaleAvgWeight: latestMemSub.femaleAvgWeight,
          maleAvgWeight: latestMemSub.maleAvgWeight,
        } : f.audit,
        updatedAt: f.updatedAt,
        createdAt: f.createdAt,
        _count: { sheds: f.sheds.length, submissions: farmSubs.length },
      };
    });
  return res.json(summaries);
});

// --------------------------------------------------------------------------
// 1.B POST /api/farms/:farmId/assign-operators - Assign Field Operators to Farm (Req 5)
// --------------------------------------------------------------------------
farmRouter.post('/farms/:farmId/assign-operators', async (req: Request, res: Response) => {
  const { farmId } = req.params;
  const { operatorUserIds } = req.body;
  if (!Array.isArray(operatorUserIds)) {
    return res.status(400).json({ error: 'operatorUserIds must be an array of user IDs' });
  }

  if (isPostgresConfigured()) {
    try {
      const farm = await prisma.farm.findUnique({ where: { id: farmId } });
      if (!farm) {
        return res.status(404).json({ error: 'Farm not found in database' });
      }

      // Query all eligible field operators (Supervisor, In-Charge, Incharge)
      const fieldUsers = await prisma.user.findMany({
        where: {
          role: { in: ['Supervisor', 'In-Charge', 'Incharge'] }
        }
      });

      const updatedAssignedUserNames: string[] = [];

      for (const user of fieldUsers) {
        const shouldBeAssigned = operatorUserIds.includes(user.id);
        const currentAssigned = new Set((user.assignedFarms || []).filter(af => af !== '*'));

        if (shouldBeAssigned) {
          currentAssigned.add(farm.id);
          currentAssigned.add(farm.name);
          updatedAssignedUserNames.push(`${user.name} (${user.role})`);
        } else {
          currentAssigned.delete(farm.id);
          currentAssigned.delete(farm.name);
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            assignedFarms: Array.from(currentAssigned)
          }
        });
      }

      return res.json({
        success: true,
        farmId,
        assignedUserNames: updatedAssignedUserNames,
        count: updatedAssignedUserNames.length
      });
    } catch (err: any) {
      console.error('❌ [DB] Error in /assign-operators:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to update operator assignments in PostgreSQL.',
        details: err?.message
      });
    }
  }

  // Offline / memory fallback
  const memFarm = memoryFarms.find(f => f.id === farmId);
  const updatedAssignedUserNames: string[] = [];
  memoryUsers.forEach(user => {
    if (user.role === 'Supervisor' || user.role === 'In-Charge' || user.role === 'Incharge') {
      const shouldBeAssigned = operatorUserIds.includes(user.id);
      const set = new Set((user.assignedFarms || []).filter(af => af !== '*'));
      if (shouldBeAssigned) {
        set.add(farmId);
        if (memFarm) set.add(memFarm.name);
        updatedAssignedUserNames.push(`${user.name} (${user.role})`);
      } else {
        set.delete(farmId);
        if (memFarm) set.delete(memFarm.name);
      }
      user.assignedFarms = Array.from(set);
    }
  });

  return res.json({
    success: true,
    farmId,
    assignedUserNames: updatedAssignedUserNames,
    count: updatedAssignedUserNames.length
  });
});

// --------------------------------------------------------------------------
// 2. POST /api/farms - Create new farm with dynamic sheds and sex split
// --------------------------------------------------------------------------
farmRouter.post('/farms', async (req: Request, res: Response) => {
  const user = await getAuthUserFromRequest(req);
  if (user && user.role !== 'Admin' && user.role !== 'Manager') {
    return res.status(403).json({ error: 'Access Denied: Only Admin and Manager accounts can create new farms.' });
  }

  const { name, flockDate, ageWeek, season, shedCount, defaultSexSplit } = req.body;
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return res.status(400).json({ error: 'Farm name is required and cannot be blank.' });
  }
  if (trimmedName.length > 100) {
    return res.status(400).json({ error: 'Farm name cannot exceed 100 characters.' });
  }

  const farmDate = flockDate || new Date().toISOString().split('T')[0];
  const farmAge = ageWeek || 'W18';
  const farmSeason = season || 'Summer';
  const farmId = crypto.randomUUID();

  const rawCount = shedCount !== undefined && shedCount !== null && shedCount !== '' ? Number(shedCount) : 0;
  const count = isNaN(rawCount) || rawCount < 0 ? 0 : Math.min(50, rawCount);
  const sexSplit = defaultSexSplit || 'last_male';

  if (isPostgresConfigured()) {
    try {
      // Check duplicate name
      const duplicate = await prisma.farm.findFirst({
        where: { name: { equals: trimmedName, mode: 'insensitive' } }
      });
      if (duplicate) {
        return res.status(400).json({ error: `A farm named "${trimmedName}" already exists.` });
      }

      const shedsData = [];
      for (let i = 1; i <= count; i++) {
        const isMale = sexSplit === 'all_male' ? true : (sexSplit === 'all_female' ? false : (count > 1 ? i === count : false));
        shedsData.push({
          name: isMale ? `Shed ${i} Male` : `Shed ${i}`,
          type: (isMale ? 'Male' : 'Female') as 'Male' | 'Female',
          order: i,
        });
      }

      const newFarm = await prisma.farm.create({
        data: {
          id: farmId,
          name: trimmedName,
          flockDate: farmDate,
          ageWeek: farmAge,
          season: farmSeason,
          ...(shedsData.length > 0 && {
            sheds: {
              create: shedsData,
            },
          }),
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

      // If created by a manager without '*', assign them to this farm
      if (user && user.role === 'Manager' && !user.assignedFarms.includes('*')) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              assignedFarms: [...user.assignedFarms, newFarm.id, newFarm.name]
            }
          });
        } catch {}
      }

      return res.status(201).json(newFarm);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL create farm failed:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to create farm in PostgreSQL database.',
        code: err?.code || 'DB_ERROR',
        details: err?.message,
      });
    }
  }

  // Memory fallback
  const duplicateMem = memoryFarms.find(f => f.name.toLowerCase() === trimmedName.toLowerCase());
  if (duplicateMem) {
    return res.status(400).json({ error: `A farm named "${trimmedName}" already exists.` });
  }

  const fallbackSheds: MemShed[] = [];
  for (let i = 1; i <= count; i++) {
    const isMale = sexSplit === 'all_male' ? true : (sexSplit === 'all_female' ? false : (count > 1 ? i === count : false));
    const shedId = `shed-${farmId}-${i}`;
    fallbackSheds.push({
      id: shedId,
      farmId,
      name: isMale ? `Shed ${i} Male` : `Shed ${i}`,
      type: isMale ? 'Male' : 'Female',
      order: i,
      parts: [],
    });
  }

  const newMemFarm: MemFarm = {
    id: farmId,
    name: trimmedName,
    flockDate: farmDate,
    ageWeek: farmAge,
    season: farmSeason,
    createdAt: new Date(),
    updatedAt: new Date(),
    sheds: fallbackSheds,
  };
  memoryFarms.unshift(newMemFarm);
  return res.status(201).json(newMemFarm);
});

// --------------------------------------------------------------------------
// 3. GET /api/farms/:id - Get full farm details with hierarchy
// --------------------------------------------------------------------------
farmRouter.get('/farms/:id', async (req: Request, res: Response) => {
  const farmId = req.params.id;
  const authUser = await getAuthUserFromRequest(req);

  if (isPostgresConfigured()) {
    try {
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
          submissions: {
            orderBy: { submittedAt: 'desc' },
            take: 20,
            select: {
              id: true,
              farmId: true,
              status: true,
              submittedAt: true,
              submitterName: true,
              submitterRole: true,
              totalBirds: true,
              femaleAvgWeight: true,
              maleAvgWeight: true,
              overallAvgWeight: true,
              uniformity: true,
            }
          },
          _count: {
            select: { sheds: true, submissions: true }
          }
        },
      });
      if (!farm) {
        return res.status(404).json({ error: 'Farm not found in PostgreSQL database' });
      }

      // Enforce assigned-farm visibility on direct API requests (Req 8)
      if (authUser) {
        if (authUser.role === 'Supervisor' || authUser.role === 'In-Charge') {
          const userAssigned = authUser.assignedFarms || [];
          if (!userAssigned.includes(farm.id) && !userAssigned.includes(farm.name)) {
            return res.status(403).json({ error: 'Access denied: You are not assigned to this farm unit.' });
          }
        } else if (authUser.role === 'Manager') {
          const userAssigned = authUser.assignedFarms || [];
          if (userAssigned.length > 0 && !userAssigned.includes('*')) {
            if (!userAssigned.includes(farm.id) && !userAssigned.includes(farm.name)) {
              return res.status(403).json({ error: 'Access denied: You are not authorized for this farm unit.' });
            }
          }
        }
      }

      const latestSub = farm.submissions && farm.submissions[0];
      const isCompleted = Boolean(latestSub && latestSub.status === 'COMPLETED');
      const audit = latestSub ? {
        status: isCompleted ? 'COMPLETED' : 'DRAFT',
        lastSubmittedAt: latestSub.submittedAt ? new Date(latestSub.submittedAt).toISOString() : null,
        lastSubmittedBy: latestSub.submitterName,
        lastSubmittedRole: latestSub.submitterRole,
        submittedBy: latestSub.submitterName,
        submittedRole: latestSub.submitterRole,
        totalBirdsSubmitted: latestSub.totalBirds,
        femaleAvgWeight: latestSub.femaleAvgWeight,
        maleAvgWeight: latestSub.maleAvgWeight,
      } : undefined;

      return res.json({
        ...farm,
        status: isCompleted ? 'COMPLETED' : 'DRAFT',
        submissionCount: farm._count.submissions,
        audit,
      });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL get /farms/:id error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to retrieve farm from PostgreSQL database.',
        code: err?.code || 'DB_ERROR',
        details: err?.message,
      });
    }
  }

  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) {
    return res.status(404).json({ error: 'Farm not found' });
  }

  if (authUser) {
    if (authUser.role === 'Supervisor' || authUser.role === 'In-Charge') {
      const userAssigned = authUser.assignedFarms || [];
      if (!userAssigned.includes(memFarm.id) && !userAssigned.includes(memFarm.name)) {
        return res.status(403).json({ error: 'Access denied: You are not assigned to this farm unit.' });
      }
    } else if (authUser.role === 'Manager') {
      const userAssigned = authUser.assignedFarms || [];
      if (userAssigned.length > 0 && !userAssigned.includes('*')) {
        if (!userAssigned.includes(memFarm.id) && !userAssigned.includes(memFarm.name)) {
          return res.status(403).json({ error: 'Access denied: You are not authorized for this farm unit.' });
        }
      }
    }
  }

  const farmSubs = memorySubmissions.filter(s => s.farmId === farmId);
  const latestMemSub = farmSubs[0];
  const isCompleted = Boolean(latestMemSub && latestMemSub.status === 'COMPLETED');
  const audit = latestMemSub ? {
    status: isCompleted ? 'COMPLETED' : 'DRAFT',
    lastSubmittedAt: latestMemSub.submittedAt ? new Date(latestMemSub.submittedAt).toISOString() : null,
    lastSubmittedBy: latestMemSub.submitterName,
    lastSubmittedRole: latestMemSub.submitterRole,
    submittedBy: latestMemSub.submitterName,
    submittedRole: latestMemSub.submitterRole,
    totalBirdsSubmitted: latestMemSub.totalBirds,
    femaleAvgWeight: latestMemSub.femaleAvgWeight,
    maleAvgWeight: latestMemSub.maleAvgWeight,
  } : memFarm.audit;

  return res.json({
    ...memFarm,
    status: isCompleted ? 'COMPLETED' : (memFarm.status || 'DRAFT'),
    submissions: farmSubs.slice(0, 20),
    submissionCount: farmSubs.length,
    _count: { sheds: memFarm.sheds.length, submissions: farmSubs.length },
    audit,
  });
});

// --------------------------------------------------------------------------
// 4. PUT /api/farms/:id/details - Update farm metadata
// --------------------------------------------------------------------------
farmRouter.put('/farms/:id/details', async (req: Request, res: Response) => {
  const farmId = req.params.id;
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const { name, flockDate, ageWeek, season } = req.body;
  const now = new Date();

  // Validate farm name if provided
  let trimmedName: string | undefined = undefined;
  if (name !== undefined) {
    trimmedName = String(name).trim();
    if (!trimmedName || trimmedName.length === 0) {
      return res.status(400).json({ error: 'Farm name cannot be blank.' });
    }
    if (trimmedName.length > 100) {
      return res.status(400).json({ error: 'Farm name cannot exceed 100 characters.' });
    }
  }

  if (isPostgresConfigured()) {
    try {
      const existing = await prisma.farm.findUnique({
        where: { id: farmId },
        include: {
          _count: { select: { sheds: true, submissions: true } }
        }
      });
      if (!existing) {
        return res.status(404).json({ error: 'Farm not found in PostgreSQL database.' });
      }

      // Check permissions:
      // Admin: can edit any farm
      // Manager: can edit if assigned to '*' or farm is in user.assignedFarms
      // Supervisor / In-Charge: can edit ONLY if explicitly authorized for that assigned farm
      const userAssigned = user.assignedFarms || [];
      const isAssigned = userAssigned.includes('*') || userAssigned.includes(existing.id) || userAssigned.includes(existing.name);
      
      if (user.role === 'Admin') {
        // Allowed
      } else if (user.role === 'Manager') {
        if (!isAssigned) {
          return res.status(403).json({ error: 'Access Denied: You are not authorized to edit this farm.' });
        }
      } else if (user.role === 'Supervisor' || user.role === 'In-Charge' || user.role === 'Incharge') {
        if (!isAssigned) {
          return res.status(403).json({ error: 'Access Denied: You can only edit farm details for your explicitly assigned farm.' });
        }
      } else {
        return res.status(403).json({ error: 'Access Denied: Insufficient permissions to edit farm.' });
      }

      // If name is changing, check for duplicate name
      if (trimmedName && trimmedName.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await prisma.farm.findFirst({
          where: {
            id: { not: farmId },
            name: { equals: trimmedName, mode: 'insensitive' }
          }
        });
        if (duplicate) {
          return res.status(400).json({ error: `A farm named "${trimmedName}" already exists.` });
        }
      }

      const updated = await prisma.farm.update({
        where: { id: farmId },
        data: {
          ...(trimmedName && { name: trimmedName }),
          ...(flockDate && { flockDate }),
          ...(ageWeek && { ageWeek }),
          ...(season && { season }),
          updatedAt: now,
        },
        include: {
          _count: { select: { sheds: true, submissions: true } }
        }
      });

      // If farm name changed, preserve and synchronize operator assignments
      if (trimmedName && trimmedName !== existing.name) {
        try {
          const usersWithFarm = await prisma.user.findMany({
            where: {
              OR: [
                { assignedFarms: { has: existing.name } },
                { assignedFarms: { has: existing.id } }
              ]
            }
          });
          for (const u of usersWithFarm) {
            const rawAssigned: string[] = u.assignedFarms || [];
            const newAssigned: string[] = rawAssigned.map((af: string) => (af === existing.name ? trimmedName! : af));
            if (!newAssigned.includes(trimmedName!)) newAssigned.push(trimmedName!);
            if (!newAssigned.includes(farmId)) newAssigned.push(farmId);
            await prisma.user.update({
              where: { id: u.id },
              data: { assignedFarms: newAssigned }
            });
          }

          // Create activity log
          await prisma.activityLog.create({
            data: {
              farmId,
              userId: user.id,
              userName: `${user.name} (${user.role})`,
              action: `Farm renamed from "${existing.name}" to "${trimmedName}"`,
              status: 'COMPLETED',
            }
          });
        } catch (logErr) {
          console.warn('PostgreSQL log/assignment update notice:', logErr);
        }
      }

      return res.json({
        ...updated,
        message: 'Farm details updated successfully.'
      });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL update details error:', err?.message || err);
      return res.status(503).json({
        error: 'Not connected to server. Please try again.',
        details: err?.message,
      });
    }
  }

  // Memory fallback
  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });

  const userAssigned = user.assignedFarms || [];
  const isAssigned = userAssigned.includes('*') || userAssigned.includes(memFarm.id) || userAssigned.includes(memFarm.name);
  if (user.role !== 'Admin' && !isAssigned) {
    return res.status(403).json({ error: 'Access Denied: You are not authorized to edit this farm.' });
  }

  if (trimmedName && trimmedName.toLowerCase() !== memFarm.name.toLowerCase()) {
    const dup = memoryFarms.find(f => f.id !== farmId && f.name.toLowerCase() === trimmedName!.toLowerCase());
    if (dup) {
      return res.status(400).json({ error: `A farm named "${trimmedName}" already exists.` });
    }
    const oldName = memFarm.name;
    memFarm.name = trimmedName;

    // Update memory users' assignedFarms
    memoryUsers.forEach(u => {
      if ((u.assignedFarms || []).includes(oldName)) {
        u.assignedFarms = u.assignedFarms.map(af => (af === oldName ? trimmedName! : af));
        if (!u.assignedFarms.includes(trimmedName!)) u.assignedFarms.push(trimmedName!);
      }
    });
  }

  if (flockDate) memFarm.flockDate = flockDate;
  if (ageWeek) memFarm.ageWeek = ageWeek;
  if (season) memFarm.season = season;
  memFarm.updatedAt = now;

  return res.json({
    ...memFarm,
    message: 'Farm details updated successfully.'
  });
});

// --------------------------------------------------------------------------
// 5.A GET /api/farms/:id/delete-impact - Check record count before deletion (Admin only)
// --------------------------------------------------------------------------
farmRouter.get('/farms/:id/delete-impact', async (req: Request, res: Response) => {
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  if (user.role !== 'Admin') {
    return res.status(403).json({ error: 'Access Denied: Only Administrator accounts can inspect farm deletion impact.' });
  }

  const farmId = req.params.id;

  if (isPostgresConfigured()) {
    try {
      const farm = await prisma.farm.findUnique({
        where: { id: farmId },
        include: {
          _count: {
            select: {
              sheds: true,
              submissions: true,
              logs: true,
            }
          }
        }
      });

      if (!farm) {
        return res.status(404).json({ error: 'Farm not found in database.' });
      }

      // Count bird weights, parts, and lines
      const [birdWeightsCount, partsCount, linesCount] = await Promise.all([
        prisma.birdWeight.count({ where: { farmId } }),
        prisma.part.count({ where: { shed: { farmId } } }),
        prisma.line.count({ where: { part: { shed: { farmId } } } }),
      ]);

      const shedsCount = farm._count.sheds;
      const submissionsCount = farm._count.submissions;
      const logsCount = farm._count.logs;
      const hasRecords = shedsCount > 0 || submissionsCount > 0 || birdWeightsCount > 0 || logsCount > 0;

      return res.json({
        farmId: farm.id,
        farmName: farm.name,
        isArchived: farm.isArchived,
        hasRecords,
        shedsCount,
        partsCount,
        linesCount,
        submissionsCount,
        birdWeightsCount,
        logsCount,
      });
    } catch (err: any) {
      console.error('❌ [DB] Delete impact inspection error:', err?.message || err);
      return res.status(500).json({ error: 'Failed to inspect farm deletion impact', details: err?.message });
    }
  }

  // Memory fallback
  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });

  const shedsCount = memFarm.sheds.length;
  const partsCount = memFarm.sheds.reduce((acc, s) => acc + s.parts.length, 0);
  const linesCount = memFarm.sheds.reduce((acc, s) => acc + s.parts.reduce((pAcc, p) => pAcc + p.lines.length, 0), 0);
  const memSubs = memorySubmissions.filter(s => s.farmId === farmId);
  const submissionsCount = memSubs.length;
  const memBws = memoryBirdWeights.filter(bw => bw.farmId === farmId);
  const birdWeightsCount = memBws.length;
  const memLogsForFarm = memoryLogs.filter(l => l.farmId === farmId);
  const logsCount = memLogsForFarm.length;
  const hasRecords = shedsCount > 0 || submissionsCount > 0 || birdWeightsCount > 0;

  return res.json({
    farmId: memFarm.id,
    farmName: memFarm.name,
    isArchived: Boolean(memFarm.isArchived),
    hasRecords,
    shedsCount,
    partsCount,
    linesCount,
    submissionsCount,
    birdWeightsCount,
    logsCount,
  });
});

// --------------------------------------------------------------------------
// 5.B DELETE /api/farms/:id - Safe Archive or Authorized Permanent Delete (Admin only)
// --------------------------------------------------------------------------
farmRouter.delete('/farms/:id', async (req: Request, res: Response) => {
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  if (user.role !== 'Admin') {
    return res.status(403).json({ error: 'Access Denied: Only Administrator accounts can delete or archive farms.' });
  }

  const farmId = req.params.id;
  const mode = (req.body?.mode || req.query.mode || 'archive') as 'archive' | 'permanent';
  const confirmFarmName = req.body?.confirmFarmName || req.query.confirmFarmName;

  if (isPostgresConfigured()) {
    try {
      const farm = await prisma.farm.findUnique({
        where: { id: farmId },
        include: {
          _count: {
            select: {
              sheds: true,
              submissions: true,
              logs: true,
            }
          }
        }
      });
      if (!farm) {
        return res.status(404).json({ error: 'Farm not found in PostgreSQL database.' });
      }

      const birdWeightCount = await prisma.birdWeight.count({ where: { farmId } });
      const hasRecords = farm._count.sheds > 0 || farm._count.submissions > 0 || birdWeightCount > 0;

      // Safe Policy: Archive (Soft-Delete)
      if (mode === 'archive' || (hasRecords && mode !== 'permanent')) {
        const archived = await prisma.farm.update({
          where: { id: farmId },
          data: {
            isArchived: true,
            archivedAt: new Date(),
          }
        });

        // Log archiving activity
        try {
          await prisma.activityLog.create({
            data: {
              farmId,
              userId: user.id,
              userName: `${user.name} (Admin)`,
              action: `Farm "${farm.name}" Archived (Safe soft-delete). Historical submissions preserved.`,
              status: 'COMPLETED',
            }
          });
        } catch {}

        return res.json({
          success: true,
          archived: true,
          message: `Farm "${farm.name}" has been safely archived. Historical submissions and bird weights remain intact and accessible to authorized users.`,
          farm: archived,
        });
      }

      // Permanent Delete Mode: Strict confirmation required!
      if (mode === 'permanent') {
        if (!confirmFarmName || String(confirmFarmName).trim().toLowerCase() !== farm.name.trim().toLowerCase()) {
          return res.status(400).json({
            error: `Permanent deletion requires typing the exact farm name "${farm.name}" to confirm.`
          });
        }

        // Delete cascade records safely within transaction
        await prisma.$transaction(async (tx) => {
          await tx.birdWeight.deleteMany({ where: { farmId } });
          await tx.submission.deleteMany({ where: { farmId } });
          await tx.activityLog.deleteMany({ where: { farmId } });
          await tx.farm.delete({ where: { id: farmId } });
        });

        return res.json({
          success: true,
          permanentlyDeleted: true,
          message: `Farm "${farm.name}" and all related data have been permanently deleted.`,
        });
      }
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete farm error:', err?.message || err);
      return res.status(503).json({
        error: 'Not connected to server. Please try again.',
        details: err?.message,
      });
    }
  }

  // Memory fallback
  const idx = memoryFarms.findIndex(f => f.id === farmId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Farm not found' });
  }

  const memFarm = memoryFarms[idx];
  const memSubsCount = memorySubmissions.filter(s => s.farmId === farmId).length;
  const hasMemRecords = memFarm.sheds.length > 0 || memSubsCount > 0;

  if (mode === 'archive' || (hasMemRecords && mode !== 'permanent')) {
    memFarm.isArchived = true;
    memFarm.archivedAt = new Date();
    return res.json({
      success: true,
      archived: true,
      message: `Farm "${memFarm.name}" safely archived. Historical submissions remain preserved.`,
      farm: memFarm,
    });
  }

  if (mode === 'permanent') {
    if (!confirmFarmName || String(confirmFarmName).trim().toLowerCase() !== memFarm.name.trim().toLowerCase()) {
      return res.status(400).json({
        error: `Permanent deletion requires typing the exact farm name "${memFarm.name}" to confirm.`
      });
    }

    memoryFarms.splice(idx, 1);
    return res.json({
      success: true,
      permanentlyDeleted: true,
      message: `Farm "${memFarm.name}" permanently deleted.`,
    });
  }
});

// --------------------------------------------------------------------------
// 5.C POST /api/farms/:id/restore - Restore an archived farm (Admin only)
// --------------------------------------------------------------------------
farmRouter.post('/farms/:id/restore', async (req: Request, res: Response) => {
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  if (user.role !== 'Admin') {
    return res.status(403).json({ error: 'Access Denied: Only Administrator accounts can restore farms.' });
  }

  const farmId = req.params.id;

  if (isPostgresConfigured()) {
    try {
      const restored = await prisma.farm.update({
        where: { id: farmId },
        data: {
          isArchived: false,
          archivedAt: null,
        }
      });
      return res.json({
        success: true,
        message: `Farm "${restored.name}" restored successfully.`,
        farm: restored,
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to restore farm', details: err?.message });
    }
  }

  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });

  memFarm.isArchived = false;
  memFarm.archivedAt = null;
  return res.json({
    success: true,
    message: `Farm "${memFarm.name}" restored successfully.`,
    farm: memFarm,
  });
});

// --------------------------------------------------------------------------
// 6. POST /api/sheds - Add new shed to farm
// --------------------------------------------------------------------------
farmRouter.post('/sheds', async (req: Request, res: Response) => {
  const { farmId, name, type, order } = req.body;
  if (!farmId || !name || !String(name).trim()) {
    return res.status(400).json({ error: 'farmId and non-blank shed name required' });
  }

  const trimmedName = String(name).trim();
  const shedId = crypto.randomUUID();
  const shedOrder = Number(order) || 1;
  const shedType = type === 'Male' ? 'Male' : 'Female';

  if (isPostgresConfigured()) {
    try {
      const existing = await prisma.shed.findFirst({
        where: {
          farmId,
          name: { equals: trimmedName, mode: 'insensitive' }
        }
      });
      if (existing) {
        return res.status(400).json({ error: `A shed named "${trimmedName}" already exists on this farm.` });
      }

      const newShed = await prisma.shed.create({
        data: {
          id: shedId,
          farmId,
          name: trimmedName,
          type: shedType,
          order: shedOrder,
        },
        include: {
          parts: { include: { lines: true } },
        },
      });
      await touchFarm(farmId);
      return res.status(201).json(newShed);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL create shed error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to add shed in PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });

  const dupMem = memFarm.sheds.find(s => s.name.toLowerCase() === trimmedName.toLowerCase());
  if (dupMem) {
    return res.status(400).json({ error: `A shed named "${trimmedName}" already exists on this farm.` });
  }

  const newMemShed: MemShed = {
    id: shedId,
    farmId,
    name: trimmedName,
    type: shedType,
    order: shedOrder || memFarm.sheds.length + 1,
    parts: [],
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
  if (isPostgresConfigured()) {
    try {
      const shed = await prisma.shed.findUnique({ where: { id: shedId } });
      if (shed) {
        await prisma.shed.delete({ where: { id: shedId } });
        await touchFarm(shed.farmId);
        return res.json({ success: true });
      }
      return res.status(404).json({ error: 'Shed not found in PostgreSQL database' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete shed error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to delete shed from PostgreSQL database.',
        details: err?.message,
      });
    }
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
  const validGender = type !== undefined ? (type === 'Male' ? 'Male' : 'Female') : undefined;
  const trimmedName = name !== undefined ? String(name).trim() : undefined;

  if (trimmedName !== undefined && trimmedName.length === 0) {
    return res.status(400).json({ error: 'Shed name cannot be blank.' });
  }

  if (isPostgresConfigured()) {
    try {
      const currentShed = await prisma.shed.findUnique({ where: { id: shedId } });
      if (!currentShed) {
        return res.status(404).json({ error: 'Shed not found' });
      }

      if (trimmedName && trimmedName.toLowerCase() !== currentShed.name.toLowerCase()) {
        const dup = await prisma.shed.findFirst({
          where: {
            farmId: currentShed.farmId,
            id: { not: shedId },
            name: { equals: trimmedName, mode: 'insensitive' }
          }
        });
        if (dup) {
          return res.status(400).json({ error: `A shed named "${trimmedName}" already exists on this farm.` });
        }
      }

      const updated = await prisma.shed.update({
        where: { id: shedId },
        data: {
          ...(trimmedName && { name: trimmedName }),
          ...(validGender && { type: validGender }),
        },
        include: {
          parts: { include: { lines: true } }
        }
      });
      await touchFarm(updated.farmId);
      return res.json(updated);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL update shed error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to update shed in PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  for (const farm of memoryFarms) {
    const s = farm.sheds.find(shed => shed.id === shedId);
    if (s) {
      if (trimmedName && trimmedName.toLowerCase() !== s.name.toLowerCase()) {
        const dup = farm.sheds.find(other => other.id !== shedId && other.name.toLowerCase() === trimmedName.toLowerCase());
        if (dup) {
          return res.status(400).json({ error: `A shed named "${trimmedName}" already exists on this farm.` });
        }
        s.name = trimmedName;
      }
      if (validGender) s.type = validGender;
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

  if (isPostgresConfigured()) {
    try {
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
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL create part error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to create part in PostgreSQL database.',
        details: err?.message,
      });
    }
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
  if (isPostgresConfigured()) {
    try {
      const part = await prisma.part.findUnique({
        where: { id: partId },
        include: { shed: true },
      });
      if (part) {
        await prisma.part.delete({ where: { id: partId } });
        await touchFarm(part.shed.farmId);
        return res.json({ success: true });
      }
      return res.status(404).json({ error: 'Part not found in PostgreSQL database' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete part error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to delete part from PostgreSQL database.',
        details: err?.message,
      });
    }
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
  if (isPostgresConfigured()) {
    try {
      const updated = await prisma.part.update({
        where: { id: partId },
        data: { name: name?.trim() },
        include: { shed: true },
      });
      await touchFarm(updated.shed.farmId);
      return res.json(updated);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL rename part error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to rename part in PostgreSQL database.',
        details: err?.message,
      });
    }
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

  if (isPostgresConfigured()) {
    try {
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
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL create line error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to create line in PostgreSQL database.',
        details: err?.message,
      });
    }
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
  if (isPostgresConfigured()) {
    try {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: true } } },
      });
      if (line) {
        await prisma.line.delete({ where: { id: lineId } });
        await touchFarm(line.part.shed.farmId);
        return res.json({ success: true });
      }
      return res.status(404).json({ error: 'Line not found in PostgreSQL database' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete line error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to delete line from PostgreSQL database.',
        details: err?.message,
      });
    }
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

// --------------------------------------------------------------------------
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

  if (isPostgresConfigured()) {
    try {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: { include: { farm: true } } } } },
      });
      if (!line) {
        return res.status(404).json({ error: 'Line not found in PostgreSQL database' });
      }

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
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL add weight error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to record bird weight in PostgreSQL database.',
        details: err?.message,
      });
    }
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

  if (isPostgresConfigured()) {
    try {
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
      return res.status(404).json({ error: 'Line or weight index not found in PostgreSQL database' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete weight error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to delete weight from PostgreSQL database.',
        details: err?.message,
      });
    }
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
  if (isPostgresConfigured()) {
    try {
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
      return res.status(404).json({ error: 'Line not found in PostgreSQL database' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL clear line error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to clear line in PostgreSQL database.',
        details: err?.message,
      });
    }
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
  const { sheds, name, flockDate, ageWeek, season, status, progressPercentage, audit } = req.body;
  const now = new Date();

  if (isPostgresConfigured()) {
    try {
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
      const resultObj = (refreshed || farm) as any;
      if (status) resultObj.status = status;
      if (progressPercentage !== undefined) resultObj.progressPercentage = progressPercentage;
      if (audit) resultObj.audit = audit;
      return res.json(resultObj);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL full sync error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to synchronize farm hierarchy to PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  let memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) {
    const newFarm: MemFarm = {
      id: farmId,
      name: name?.trim() || 'Synced Farm',
      flockDate: flockDate || new Date().toISOString().split('T')[0],
      ageWeek: ageWeek || 'W18',
      season: season || 'Summer',
      status: status || 'DRAFT',
      progressPercentage: progressPercentage || 0,
      updatedAt: now,
      createdAt: now,
      sheds: sheds || [],
      audit: audit || undefined,
    };
    memoryFarms.unshift(newFarm);
    memFarm = newFarm;
  } else {
    if (name) memFarm.name = name.trim();
    if (flockDate) memFarm.flockDate = flockDate;
    if (ageWeek) memFarm.ageWeek = ageWeek;
    if (season) memFarm.season = season;
    if (status) memFarm.status = status;
    if (progressPercentage !== undefined) memFarm.progressPercentage = progressPercentage;
    if (Array.isArray(sheds)) memFarm.sheds = sheds;
    if (audit) (memFarm as any).audit = audit;
    memFarm.updatedAt = now;
  }

  return res.json(memFarm);
});

// --------------------------------------------------------------------------
// 18. POST /api/auth/login - Secure User Sign In
// --------------------------------------------------------------------------
farmRouter.post('/auth/login', async (req: Request, res: Response) => {
  const username = String(req.body.username || req.body.email || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const rateKey = username.toLowerCase();
  const rateCheck = checkRateLimit(rateKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({ 
      error: `Too many failed login attempts. Please wait ${rateCheck.waitSeconds} seconds before trying again.` 
    });
  }

  if (isPostgresConfigured()) {
    try {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: username, mode: 'insensitive' } },
            { email: { equals: username, mode: 'insensitive' } },
          ]
        }
      });

      if (!user || !verifyPassword(password, user.password)) {
        recordFailedLogin(rateKey);
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      if (user.status === 'INACTIVE') {
        return res.status(403).json({ error: 'Account is deactivated. Please contact your Administrator.' });
      }

      clearRateLimit(rateKey);
      const token = generateToken({ id: user.id, username: user.username, role: user.role });
      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          assignedFarms: user.assignedFarms || [],
          createdAt: user.createdAt,
        }
      });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL login query failed:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to authenticate against PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  // Memory fallback only for local offline simulation
  const memUser = memoryUsers.find(u => 
    u.username.toLowerCase() === username.toLowerCase() || 
    (u.email && u.email.toLowerCase() === username.toLowerCase())
  );

  if (!memUser || !verifyPassword(password, memUser.password)) {
    recordFailedLogin(rateKey);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  if (memUser.status === 'INACTIVE') {
    return res.status(403).json({ error: 'Account is deactivated. Please contact your Administrator.' });
  }

  clearRateLimit(rateKey);
  const token = generateToken({ id: memUser.id, username: memUser.username, role: memUser.role });
  return res.json({
    token,
    user: {
      id: memUser.id,
      username: memUser.username,
      name: memUser.name,
      email: memUser.email,
      role: memUser.role,
      status: memUser.status,
      assignedFarms: memUser.assignedFarms || [],
      createdAt: memUser.createdAt,
    }
  });
});

// --------------------------------------------------------------------------
// 19. GET /api/auth/me - Verify Signed Session Token
// --------------------------------------------------------------------------
farmRouter.get('/auth/me', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }

  if (isPostgresConfigured()) {
    try {
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (user && user.status === 'ACTIVE') {
        return res.json({
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            assignedFarms: user.assignedFarms || [],
          }
        });
      }
      return res.status(401).json({ error: 'User account not active or does not exist' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL /auth/me error:', err?.message || err);
      return res.status(503).json({ error: 'Database error while verifying session token' });
    }
  }

  const memUser = memoryUsers.find(u => u.id === payload.userId);
  if (memUser && memUser.status === 'ACTIVE') {
    return res.json({
      user: {
        id: memUser.id,
        username: memUser.username,
        name: memUser.name,
        email: memUser.email,
        role: memUser.role,
        status: memUser.status,
        assignedFarms: memUser.assignedFarms || [],
      }
    });
  }

  return res.status(401).json({ error: 'User account not active or does not exist' });
});

// --------------------------------------------------------------------------
// 20. POST /api/auth/logout - Terminate session
// --------------------------------------------------------------------------
farmRouter.post('/auth/logout', (_req: Request, res: Response) => {
  return res.json({ success: true, message: 'Logged out successfully' });
});

// --------------------------------------------------------------------------
// 21. GET /api/auth/users - List Accounts (Admin & Manager)
// --------------------------------------------------------------------------
farmRouter.get('/auth/users', async (_req: Request, res: Response) => {
  if (isPostgresConfigured()) {
    try {
      const users = await prisma.user.findMany({
        select: { 
          id: true, 
          username: true, 
          name: true, 
          email: true, 
          role: true, 
          status: true, 
          assignedFarms: true, 
          createdAt: true 
        },
        orderBy: { createdAt: 'asc' },
      });
      return res.json(users);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL get users error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to retrieve user accounts from PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  return res.json(memoryUsers.map(u => ({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    assignedFarms: u.assignedFarms || [],
    createdAt: u.createdAt,
  })));
});

// --------------------------------------------------------------------------
// 22. POST /api/auth/users - Create User Account (Admin Only)
// --------------------------------------------------------------------------
farmRouter.post('/auth/users', async (req: Request, res: Response) => {
  const { username, name, password, role, assignedFarms } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, full name, and initial password are required' });
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const cleanName = String(name).trim();
  const validRoles = ['Admin', 'Manager', 'Supervisor', 'In-Charge'];
  const userRole = validRoles.includes(role) ? role : 'Supervisor';
  const farmList = Array.isArray(assignedFarms) ? assignedFarms : [];
  const hashedPassword = hashPassword(String(password).trim());

  if (isPostgresConfigured()) {
    try {
      const existing = await prisma.user.findFirst({
        where: { username: { equals: cleanUsername, mode: 'insensitive' } }
      });
      if (existing) {
        return res.status(409).json({ error: `Username "${cleanUsername}" is already taken.` });
      }

      const created = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          username: cleanUsername,
          name: cleanName,
          email: `${cleanUsername}@farm.local`,
          password: hashedPassword,
          role: userRole,
          status: 'ACTIVE',
          assignedFarms: farmList,
        }
      });

      return res.status(201).json({
        id: created.id,
        username: created.username,
        name: created.name,
        role: created.role,
        status: created.status,
        assignedFarms: created.assignedFarms,
        createdAt: created.createdAt,
      });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL create user error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to create user account in PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  const existingMem = memoryUsers.find(u => u.username.toLowerCase() === cleanUsername);
  if (existingMem) {
    return res.status(409).json({ error: `Username "${cleanUsername}" is already taken.` });
  }

  const newMemUser: MemUser = {
    id: `u-${Date.now()}`,
    username: cleanUsername,
    name: cleanName,
    email: `${cleanUsername}@farm.local`,
    password: hashedPassword,
    role: userRole,
    status: 'ACTIVE',
    assignedFarms: farmList,
    createdAt: new Date(),
  };
  memoryUsers.push(newMemUser);

  return res.status(201).json({
    id: newMemUser.id,
    username: newMemUser.username,
    name: newMemUser.name,
    role: newMemUser.role,
    status: newMemUser.status,
    assignedFarms: newMemUser.assignedFarms,
    createdAt: newMemUser.createdAt,
  });
});

// --------------------------------------------------------------------------
// 23. PUT /api/auth/users/:id - Update User / Assign Farms / Toggle Status
// --------------------------------------------------------------------------
farmRouter.put('/auth/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, role, status, assignedFarms, password } = req.body;

  if (isPostgresConfigured()) {
    try {
      const updateData: any = {};
      if (name) updateData.name = String(name).trim();
      if (role) updateData.role = role;
      if (status) updateData.status = status;
      if (Array.isArray(assignedFarms)) updateData.assignedFarms = assignedFarms;
      if (password && String(password).trim().length > 0) {
        updateData.password = hashPassword(String(password).trim());
      }

      const updated = await prisma.user.update({
        where: { id },
        data: updateData,
      });

      return res.json({
        id: updated.id,
        username: updated.username,
        name: updated.name,
        role: updated.role,
        status: updated.status,
        assignedFarms: updated.assignedFarms,
      });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL update user error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to update user account in PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  const memUser = memoryUsers.find(u => u.id === id);
  if (!memUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (name) memUser.name = String(name).trim();
  if (role) memUser.role = role;
  if (status) memUser.status = status;
  if (Array.isArray(assignedFarms)) memUser.assignedFarms = assignedFarms;
  if (password && String(password).trim().length > 0) {
    memUser.password = hashPassword(String(password).trim());
  }

  return res.json({
    id: memUser.id,
    username: memUser.username,
    name: memUser.name,
    role: memUser.role,
    status: memUser.status,
    assignedFarms: memUser.assignedFarms,
  });
});

// --------------------------------------------------------------------------
// 24. POST /api/auth/users/:id/reset-password - Reset Password
// --------------------------------------------------------------------------
farmRouter.post('/auth/users/:id/reset-password', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || String(newPassword).trim().length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long' });
  }

  const hashed = hashPassword(String(newPassword).trim());

  if (isPostgresConfigured()) {
    try {
      await prisma.user.update({
        where: { id },
        data: { password: hashed },
      });
      return res.json({ success: true, message: 'Password reset successfully in PostgreSQL database' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL reset password error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to reset password in PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  const memUser = memoryUsers.find(u => u.id === id);
  if (!memUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  memUser.password = hashed;
  return res.json({ success: true, message: 'Password reset successfully' });
});

// --------------------------------------------------------------------------
// 25. DELETE /api/auth/users/:id - Delete User Account
// --------------------------------------------------------------------------
farmRouter.delete('/auth/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (isPostgresConfigured()) {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (user?.role === 'Admin') {
        const adminCount = await prisma.user.count({ where: { role: 'Admin' } });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the sole Administrator account' });
        }
      }
      await prisma.user.delete({ where: { id } });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete user error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to delete user account from PostgreSQL database.',
        details: err?.message,
      });
    }
  }

  const idx = memoryUsers.findIndex(u => u.id === id);
  if (idx !== -1) {
    if (memoryUsers[idx].role === 'Admin') {
      const adminCount = memoryUsers.filter(u => u.role === 'Admin').length;
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the sole Administrator account' });
      }
    }
    memoryUsers.splice(idx, 1);
    return res.json({ success: true });
  }

  return res.status(404).json({ error: 'User not found' });
});

// --------------------------------------------------------------------------
// 26. GET /api/logs - Activity update history logs
// --------------------------------------------------------------------------
farmRouter.get('/logs', async (req: Request, res: Response) => {
  const farmId = req.query.farmId as string | undefined;
  const liveOnly = req.query.liveOnly === 'true';
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);

  const now = Date.now();

  if (isPostgresConfigured()) {
    try {
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
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL get /logs query failed:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to retrieve activity logs from PostgreSQL database.',
        code: err?.code || 'DB_ERROR',
        details: err?.message || 'Database query failed',
      });
    }
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
// 27. POST /api/logs - Create custom activity log entry
// --------------------------------------------------------------------------
farmRouter.post('/logs', async (req: Request, res: Response) => {
  const { farmId, userId, userName, action, shedName, partName, lineName, sampleCount, avgWeight, status } = req.body;
  if (!farmId) return res.status(400).json({ error: 'farmId required' });

  const logId = crypto.randomUUID();
  const logUserName = userName?.trim() || 'Supervisor';
  const logAction = action?.trim() || 'Updated bodyweight';
  const logStatus = status || 'COMPLETED';

  if (isPostgresConfigured()) {
    try {
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
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL create /logs error:', err?.message || err);
      return res.status(503).json({
        error: 'Database error: Failed to record activity log in PostgreSQL database.',
        details: err?.message,
      });
    }
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
