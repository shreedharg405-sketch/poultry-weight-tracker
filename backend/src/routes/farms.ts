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

function sendSafe503(res: Response, message = 'Server is not connected') {
  return res.status(503).json({
    status: 503,
    message: 'Server is not connected. Please try again later.',
    error: message,
  });
}

function sendSafe500(res: Response, message = 'An unexpected error occurred. Please try again later.') {
  return res.status(500).json({
    status: 500,
    message,
    error: message,
  });
}

let columnsEnsured = false;
let hasAttemptedColumnEnsure = false;
export async function ensureFarmColumns(): Promise<void> {
  if (!isPostgresConfigured() || columnsEnsured || hasAttemptedColumnEnsure) return;
  hasAttemptedColumnEnsure = true;
  try {
    try {
      await prisma.$executeRawUnsafe('ALTER TABLE "Farm" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false');
      await prisma.$executeRawUnsafe('ALTER TABLE "Farm" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3)');
      await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "employeeCode" TEXT');
      await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT');
      await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "requiresPasswordChange" BOOLEAN NOT NULL DEFAULT false');
    } catch {
      await prisma.$executeRawUnsafe('ALTER TABLE farm ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false');
      await prisma.$executeRawUnsafe('ALTER TABLE farm ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3)');
      await prisma.$executeRawUnsafe('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "employeeCode" TEXT');
      await prisma.$executeRawUnsafe('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone" TEXT');
      await prisma.$executeRawUnsafe('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "requiresPasswordChange" BOOLEAN NOT NULL DEFAULT false');
    }
    columnsEnsured = true;
  } catch (err: any) {
    // Non-fatal, keep moving
  }
}

farmRouter.use((_req, _res, next) => {
  if (!columnsEnsured && !hasAttemptedColumnEnsure) {
    ensureFarmColumns().catch(() => {});
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
  assignedOperators?: string[];
  assignedUserNames?: string[];
}

export interface MemUser {
  id: string;
  username: string;
  name: string;
  email?: string;
  password: string;
  role: 'Admin' | 'Manager' | 'Supervisor' | 'In-Charge' | string;
  status: 'ACTIVE' | 'INACTIVE' | 'DEACTIVATED' | 'DELETED' | string;
  assignedFarms: string[];
  createdAt: Date;
  updatedAt?: Date;
  employeeCode?: string;
  phone?: string;
  requiresPasswordChange?: boolean;
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
    employeeCode: 'EMP0001',
    phone: '9876543210',
    name: 'Suresh Kumar',
    email: 'suresh@farm.local',
    password: hashPassword('Super@123'),
    role: 'Supervisor',
    status: 'ACTIVE',
    requiresPasswordChange: false,
    assignedFarms: ['SAI FARM - UNIT 1', 'farm-sai-1', 'Sai Farm Unit-2'],
    createdAt: new Date(),
  },
  {
    id: 'u-incharge-1',
    username: 'incharge',
    employeeCode: 'EMP0002',
    phone: '9845012345',
    name: 'Ramesh Patel',
    email: 'ramesh@farm.local',
    password: hashPassword('Incharge@123'),
    role: 'In-Charge',
    status: 'ACTIVE',
    requiresPasswordChange: false,
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

/**
 * Verifies if user has permission to view or mutate resources on a given farm.
 * - Admin: global access
 * - Manager: access unless restricted by assignedFarms without '*'
 * - Supervisor / In-Charge: access ONLY if farmId or farmName is in assignedFarms
 */
export function checkFarmAuthorization(
  user: { id: string; role: string; assignedFarms?: string[]; assignedFarmId?: string; assignedFarm?: string } | null | undefined,
  farmId: string,
  farmName?: string
): { authorized: boolean; error?: string } {
  if (!user) {
    return { authorized: false, error: 'Authentication required. Please log in.' };
  }
  const role = (user.role || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (role === 'ADMIN') return { authorized: true };

  const assignedList = [
    ...(user.assignedFarms || []),
    ...(user.assignedFarmId ? [user.assignedFarmId] : []),
    ...(user.assignedFarm ? [user.assignedFarm] : [])
  ];
  const assigned = assignedList.map(a => a.toLowerCase().trim());
  const isAssigned = assigned.includes('*') || 
    (farmId && assigned.includes(farmId.toLowerCase().trim())) || 
    (farmName && assigned.includes(farmName.toLowerCase().trim()));

  if (role === 'MANAGER') {
    if (assigned.length === 0 || isAssigned) return { authorized: true };
    return { authorized: false, error: 'Access denied: You are not authorized for this farm.' };
  }

  if (role === 'SUPERVISOR' || role === 'INCHARGE') {
    if (isAssigned) return { authorized: true };
    return { authorized: false, error: 'Access denied to unassigned farm.' };
  }

  return { authorized: false, error: 'Access denied: Insufficient permissions.' };
}

// --------------------------------------------------------------------------
// 1. GET /api/farms - Fetch all farms summaries with synchronized statuses & operator assignments
// --------------------------------------------------------------------------
farmRouter.get('/farms', async (req: Request, res: Response) => {
  const authUser = await getAuthUserFromRequest(req);
  const includeArchived = req.query.includeArchived === 'true';

  if (isPostgresConfigured()) {
    try {
      const [farms, users] = await Promise.all([
        prisma.farm.findMany({
          where: includeArchived ? {} : { isArchived: false },
          orderBy: { updatedAt: 'desc' },
          include: {
            _count: { select: { sheds: true, submissions: true } },
            submissions: {
              orderBy: { submittedAt: 'desc' },
              take: 1,
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
            }
          },
        }),
        prisma.user.findMany({
          where: {
            role: { in: ['Supervisor', 'In-Charge', 'Incharge'] }
          },
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
            assignedFarms: true,
          }
        })
      ]);

      let filteredFarms = farms;

      // Role-based visibility enforcement (Req 8)
      if (authUser) {
        const rUpper = (authUser.role || '').toUpperCase().replace(/[^A-Z]/g, '');
        if (rUpper === 'SUPERVISOR' || rUpper === 'INCHARGE') {
          const userAssigned = [
            ...(authUser.assignedFarms || []),
            ...((authUser as any).assignedFarmId ? [(authUser as any).assignedFarmId] : []),
            ...((authUser as any).assignedFarm ? [(authUser as any).assignedFarm] : [])
          ].map(a => a.toLowerCase().trim());
          if (userAssigned.length === 0) {
            return res.json([]);
          }
          filteredFarms = farms.filter(f => userAssigned.includes(f.id.toLowerCase().trim()) || userAssigned.includes(f.name.toLowerCase().trim()));
        } else if (rUpper === 'MANAGER') {
          const userAssigned = (authUser.assignedFarms || []).map(a => a.toLowerCase().trim());
          if (userAssigned.length > 0 && !userAssigned.includes('*')) {
            filteredFarms = farms.filter(f => userAssigned.includes(f.id.toLowerCase().trim()) || userAssigned.includes(f.name.toLowerCase().trim()));
          }
        }
      }

      const summaries = filteredFarms.map(f => {
        // Find assigned field operators for this farm - ONLY eligible field operators (Supervisor, In-Charge, Incharge)
        const assignedMap = new Map<string, string>();
        users
          .filter(u => (u.assignedFarms || []).some(af => af === f.id || af === f.name))
          .forEach(u => {
            assignedMap.set(u.id, `${u.name} (${u.role})`);
          });
        const assigned = Array.from(assignedMap.values());

        // Latest submission for this farm from eager load
        const latestSub = f.submissions && f.submissions[0];
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
      console.error('❌ [DB] Query failed on GET /farms:', err?.message || err);
      if (err?.code === 'P2022' || String(err?.message).includes('isArchived')) {
        try {
          columnsEnsured = false;
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

        // Resilient raw SQL query that does not require isArchived column
        try {
          const rawFarms: any[] = await prisma.$queryRawUnsafe(`
            SELECT f.id, f.name, f."flockDate", f."ageWeek", f.season, f."updatedAt", f."createdAt",
                   COUNT(DISTINCT s.id)::int as "shedsCount",
                   COUNT(DISTINCT sub.id)::int as "submissionsCount"
            FROM "Farm" f
            LEFT JOIN "Shed" s ON s."farmId" = f.id
            LEFT JOIN "Submission" sub ON sub."farmId" = f.id
            GROUP BY f.id, f.name, f."flockDate", f."ageWeek", f.season, f."updatedAt", f."createdAt"
            ORDER BY f."updatedAt" DESC
          `);
          return res.json(rawFarms.map(f => ({
            id: f.id,
            name: f.name,
            flockDate: f.flockDate,
            ageWeek: f.ageWeek,
            season: f.season,
            status: 'DRAFT',
            submissionCount: f.submissionsCount || 0,
            isArchived: false,
            archivedAt: null,
            assignedUserNames: [],
            updatedAt: f.updatedAt,
            createdAt: f.createdAt,
            _count: { sheds: f.shedsCount || 0, submissions: f.submissionsCount || 0 },
          })));
        } catch (rawErr) {
          console.error('Raw farm query fallback failed:', rawErr);
        }
      }

      if (memoryFarms && memoryFarms.length > 0) {
        return res.json(memoryFarms);
      }

      return res.status(503).json({
        error: 'Server is not connected',
        code: 'SERVER_DISCONNECTED',
        details: 'Server is not connected',
      });
    }
  }

  // Offline / local development in-memory simulation only
  let memFarmsFiltered = memoryFarms;
  if (!includeArchived) {
    memFarmsFiltered = memFarmsFiltered.filter(f => !f.isArchived);
  }

  if (authUser) {
    const rUpper = (authUser.role || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (rUpper === 'SUPERVISOR' || rUpper === 'INCHARGE') {
      const userAssigned = [
        ...(authUser.assignedFarms || []),
        ...((authUser as any).assignedFarmId ? [(authUser as any).assignedFarmId] : []),
        ...((authUser as any).assignedFarm ? [(authUser as any).assignedFarm] : [])
      ].map(a => a.toLowerCase().trim());
      if (userAssigned.length === 0) return res.json([]);
      memFarmsFiltered = memFarmsFiltered.filter(f => userAssigned.includes(f.id.toLowerCase().trim()) || userAssigned.includes(f.name.toLowerCase().trim()));
    } else if (rUpper === 'MANAGER') {
      const userAssigned = (authUser.assignedFarms || []).map(a => a.toLowerCase().trim());
      if (userAssigned.length > 0 && !userAssigned.includes('*')) {
        memFarmsFiltered = memFarmsFiltered.filter(f => userAssigned.includes(f.id.toLowerCase().trim()) || userAssigned.includes(f.name.toLowerCase().trim()));
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
      if (err?.code === 'P2022' || String(err?.message).includes('isArchived')) {
        columnsEnsured = false;
        await ensureFarmColumns();
      }
      return res.status(503).json({
        error: 'Server is not connected',
        details: 'Server is not connected'
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
// Clear Bird Weights (Make database fresh as new) - Req 8
// --------------------------------------------------------------------------
const handleClearBirdWeights = async (req: Request, res: Response) => {
  const farmId = req.body?.farmId;
  try {
    if (isPostgresConfigured()) {
      if (farmId) {
        await prisma.birdWeight.deleteMany({ where: { farmId } });
        await prisma.$executeRawUnsafe(`
          UPDATE "Line" SET weights = '{}' WHERE "partId" IN (
            SELECT p.id FROM "Part" p JOIN "Shed" s ON s.id = p."shedId" WHERE s."farmId" = $1
          )
        `, farmId).catch(async () => {
          await prisma.$executeRawUnsafe('UPDATE "Line" SET weights = \'{}\'');
        });
      } else {
        await prisma.birdWeight.deleteMany({});
        await prisma.$executeRawUnsafe('UPDATE "Line" SET weights = \'{}\'').catch(() => {});
      }
    }

    // Clear in-memory weights
    if (farmId) {
      const memFarm = memoryFarms.find(f => f.id === farmId);
      if (memFarm) {
        memFarm.sheds.forEach(s => s.parts.forEach(p => p.lines.forEach(l => { l.weights = []; })));
      }
    } else {
      memoryFarms.forEach(f => f.sheds.forEach(s => s.parts.forEach(p => p.lines.forEach(l => { l.weights = []; }))));
    }

    return res.json({
      success: true,
      message: 'All bird weights cleared successfully. Database is now fresh as new.',
      clearedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Error clearing bird weights:', err);
    return res.status(500).json({ error: 'Server is not connected' });
  }
};

farmRouter.post('/farms/clear-bird-weights', handleClearBirdWeights);
farmRouter.post('/database/clear-bird-weights', handleClearBirdWeights);

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

  let count = 0;
  if (shedCount !== undefined && shedCount !== null && shedCount !== '') {
    const rawNum = Number(shedCount);
    if (isNaN(rawNum) || !Number.isInteger(rawNum) || rawNum < 1 || rawNum > 40) {
      return res.status(400).json({ error: 'Number of sheds must be a whole number between 1 and 40.' });
    }
    count = rawNum;
  }

  const rawSheds = req.body.sheds;
  if (Array.isArray(rawSheds)) {
    if (rawSheds.length < 1 || rawSheds.length > 40) {
      return res.status(400).json({ error: 'Number of sheds must be between 1 and 40.' });
    }
    if (count === 0) {
      count = rawSheds.length;
    }
  }

  if (count < 1 || count > 40) {
    return res.status(400).json({ error: 'Number of sheds must be a whole number between 1 and 40.' });
  }

  if (isPostgresConfigured()) {
    try {
      // Check duplicate name
      const duplicate = await prisma.farm.findFirst({
        where: { name: { equals: trimmedName, mode: 'insensitive' } }
      });
      if (duplicate) {
        return res.status(400).json({ error: `A farm named "${trimmedName}" already exists.` });
      }

      const customSheds: Array<{ name: string; type: 'Male' | 'Female' }> = [];
      if (Array.isArray(rawSheds) && rawSheds.length > 0) {
        const seenNames = new Set<string>();
        for (let i = 0; i < rawSheds.length; i++) {
          const item = rawSheds[i];
          const sName = String(item.name || `Shed ${i + 1}`).trim();
          if (!sName) {
            return res.status(400).json({ error: `Shed #${i + 1} must have a valid name.` });
          }
          if (seenNames.has(sName.toLowerCase())) {
            return res.status(400).json({ error: `Duplicate shed name "${sName}" detected.` });
          }
          seenNames.add(sName.toLowerCase());
          customSheds.push({
            name: sName,
            type: item.type === 'Male' ? 'Male' : 'Female',
          });
        }
      } else {
        for (let i = 1; i <= count; i++) {
          customSheds.push({
            name: `Shed ${i}`,
            type: 'Female',
          });
        }
      }

      const shedsData = customSheds.map((s, idx) => ({
        id: crypto.randomUUID(),
        name: s.name,
        type: s.type,
        order: idx + 1,
        parts: {
          create: [
            {
              id: crypto.randomUUID(),
              name: 'Part A',
              order: 1,
              lines: {
                create: [
                  {
                    id: crypto.randomUUID(),
                    name: 'Line 1',
                    weights: [],
                  }
                ]
              }
            }
          ]
        }
      }));

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
      return sendSafe503(res);
    }
  }

  // Memory fallback
  const duplicateMem = memoryFarms.find(f => f.name.toLowerCase() === trimmedName.toLowerCase());
  if (duplicateMem) {
    return res.status(400).json({ error: `A farm named "${trimmedName}" already exists.` });
  }

  const fallbackSheds: MemShed[] = [];
  const rawMemSheds = req.body.sheds;
  if (Array.isArray(rawMemSheds) && rawMemSheds.length > 0) {
    rawMemSheds.forEach((s: any, idx: number) => {
      const shedId = `shed-${farmId}-${idx + 1}`;
      fallbackSheds.push({
        id: shedId,
        farmId,
        name: String(s.name || `Shed ${idx + 1}`).trim(),
        type: s.type === 'Male' ? 'Male' : 'Female',
        order: idx + 1,
        parts: [
          {
            id: `part-${shedId}-1`,
            shedId,
            name: 'Part A',
            order: 1,
            lines: [
              {
                id: `line-${shedId}-1`,
                partId: `part-${shedId}-1`,
                name: 'Line 1',
                weights: [],
              }
            ],
          }
        ],
      });
    });
  } else {
    for (let i = 1; i <= count; i++) {
      const shedId = `shed-${farmId}-${i}`;
      fallbackSheds.push({
        id: shedId,
        farmId,
        name: `Shed ${i}`,
        type: 'Female',
        order: i,
        parts: [
          {
            id: `part-${shedId}-1`,
            shedId,
            name: 'Part A',
            order: 1,
            lines: [
              {
                id: `line-${shedId}-1`,
                partId: `part-${shedId}-1`,
                name: 'Line 1',
                weights: [],
              }
            ],
          }
        ],
      });
    }
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
            take: 50,
            include: {
              sheds: {
                include: {
                  parts: {
                    include: {
                      lines: true
                    }
                  }
                }
              }
            }
          },
          _count: {
            select: { sheds: true, submissions: true }
          }
        },
      });
      if (!farm) {
        return res.status(404).json({ error: 'Farm not found' });
      }

      // Enforce assigned-farm visibility on direct API requests (Req 8)
      if (authUser) {
        const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
        if (!authCheck.authorized) {
          return res.status(403).json({ error: authCheck.error || 'Access denied: You are not assigned to this farm unit.' });
        }
      }

      const queryWeek = (req.query.week || req.query.flockAge) as string | undefined;
      const targetWeek = queryWeek ? queryWeek.trim().toUpperCase() : (farm.ageWeek ? farm.ageWeek.trim().toUpperCase() : 'W18');

      // Match submission strictly for the requested recording week with status COMPLETED
      const matchedSub = farm.submissions?.find((s: any) => s.flockAge?.trim().toUpperCase() === targetWeek && s.status === 'COMPLETED');

      const isCompleted = Boolean(matchedSub);
      const audit = matchedSub ? {
        status: 'COMPLETED',
        lastSubmittedAt: matchedSub.submittedAt ? new Date(matchedSub.submittedAt).toISOString() : null,
        lastSubmittedBy: matchedSub.submitterName,
        lastSubmittedRole: matchedSub.submitterRole,
        submittedBy: matchedSub.submitterName,
        submittedRole: matchedSub.submitterRole,
        totalBirdsSubmitted: matchedSub.totalBirds,
        femaleAvgWeight: matchedSub.femaleAvgWeight,
        maleAvgWeight: matchedSub.maleAvgWeight,
      } : undefined;

      // If submitted: load the read-only submitted record snapshot
      // If unsubmitted: load clean structural sheds with empty weights []
      let mappedSheds = farm.sheds || [];
      if (matchedSub && matchedSub.sheds && matchedSub.sheds.length > 0) {
        if (mappedSheds.length === 0) {
          mappedSheds = matchedSub.sheds as any;
        } else {
          mappedSheds = farm.sheds.map((s: any, sIdx: number) => {
            const matchingSubShed = matchedSub.sheds.find((ss: any) => 
              (ss.shedId && ss.shedId === s.id) || 
              (ss.name && s.name && ss.name.trim().toLowerCase() === s.name.trim().toLowerCase()) ||
              ss.order === sIdx ||
              ss.order === sIdx + 1 ||
              (s.order !== undefined && ss.order === s.order)
            );
            if (matchingSubShed && matchingSubShed.parts && matchingSubShed.parts.length > 0) {
              return {
                ...s,
                type: s.type || matchingSubShed.type || 'Female',
                parts: s.parts.map((p: any, pIdx: number) => {
                  const matchingPart = matchingSubShed.parts.find((sp: any) => 
                    (sp.partId && sp.partId === p.id) || 
                    (sp.name && p.name && sp.name.trim().toLowerCase() === p.name.trim().toLowerCase()) ||
                    sp.order === pIdx ||
                    sp.order === pIdx + 1 ||
                    (p.order !== undefined && sp.order === p.order)
                  );
                  if (matchingPart && matchingPart.lines && matchingPart.lines.length > 0) {
                    return {
                      ...p,
                      lines: p.lines.map((l: any, lIdx: number) => {
                        const matchingLine = matchingPart.lines.find((sl: any) => 
                          (sl.lineId && sl.lineId === l.id) || 
                          (sl.name && l.name && sl.name.trim().toLowerCase() === l.name.trim().toLowerCase()) ||
                          lIdx === 0
                        );
                        const subWeights = matchingLine && Array.isArray(matchingLine.weights) && matchingLine.weights.length > 0 ? matchingLine.weights : [];
                        return {
                          ...l,
                          weights: subWeights
                        };
                      })
                    };
                  }
                  return p;
                })
              };
            }
            return s;
          });
        }
      } else {
        // UN-SUBMITTED: All lines MUST have weights: []
        mappedSheds = (farm.sheds || []).map((s: any) => ({
          ...s,
          parts: (s.parts || []).map((p: any) => ({
            ...p,
            lines: (p.lines || []).map((l: any) => ({
              ...l,
              weights: []
            }))
          }))
        }));
      }

      const formattedSubmissions = (farm.submissions || []).map((s: any) => {
        const snapName = (s.metadata as any)?.snapshotData?.farmName || (s.metadata as any)?.farmName || farm.name;
        return {
          ...s,
          farmName: snapName,
          snapshotData: {
            ...((s.metadata as any)?.snapshotData || {}),
            farmName: snapName,
          }
        };
      });

      return res.json({
        ...farm,
        ageWeek: targetWeek || farm.ageWeek,
        sheds: mappedSheds,
        status: isCompleted ? 'COMPLETED' : 'DRAFT',
        submissionCount: farm.submissions ? farm.submissions.length : (farm._count?.submissions || 0),
        submissions: formattedSubmissions,
        audit,
      });
    } catch (err: any) {
      console.error('❌ [DB] Error in get /farms/:id:', err?.message || err);
      if (err?.code === 'P2022' || String(err?.message).includes('isArchived')) {
        columnsEnsured = false;
        await ensureFarmColumns();
      }
      return res.status(503).json({
        error: 'Server is not connected',
        code: 'SERVER_DISCONNECTED',
        details: 'Server is not connected',
      });
    }
  }

  const memFarm = memoryFarms.find(f => f.id === farmId || f.name?.trim().toLowerCase() === farmId.trim().toLowerCase());
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

  const queryWeekMem = (req.query.week || req.query.flockAge) as string | undefined;
  const targetWeekMem = queryWeekMem ? queryWeekMem.trim().toUpperCase() : (memFarm.ageWeek ? memFarm.ageWeek.trim().toUpperCase() : 'W18');

  const farmSubs = memorySubmissions.filter(s => s.farmId === farmId || (memFarm.name && s.farmName?.trim().toLowerCase() === memFarm.name.trim().toLowerCase()));
  const matchedMemSub = farmSubs.find(s => s.flockAge?.trim().toUpperCase() === targetWeekMem && s.status === 'COMPLETED');
  const isCompleted = Boolean(matchedMemSub);
  const audit = matchedMemSub ? {
    status: 'COMPLETED',
    lastSubmittedAt: matchedMemSub.submittedAt ? new Date(matchedMemSub.submittedAt).toISOString() : null,
    lastSubmittedBy: matchedMemSub.submitterName,
    lastSubmittedRole: matchedMemSub.submitterRole,
    submittedBy: matchedMemSub.submitterName,
    submittedRole: matchedMemSub.submitterRole,
    totalBirdsSubmitted: matchedMemSub.totalBirds,
    femaleAvgWeight: matchedMemSub.femaleAvgWeight,
    maleAvgWeight: matchedMemSub.maleAvgWeight,
  } : undefined;

  let mappedMemSheds = memFarm.sheds || [];
  if (matchedMemSub && matchedMemSub.sheds && matchedMemSub.sheds.length > 0) {
    if (mappedMemSheds.length === 0) {
      mappedMemSheds = matchedMemSub.sheds;
    } else {
      mappedMemSheds = memFarm.sheds.map((s, sIdx) => {
        const matchingSubShed = matchedMemSub.sheds.find((ss: any) => 
          ss.id === s.id || 
          ss.name?.trim().toLowerCase() === s.name?.trim().toLowerCase() ||
          ss.order === sIdx
        );
        if (matchingSubShed && matchingSubShed.parts) {
          return {
            ...s,
            type: matchingSubShed.type || s.type,
            parts: s.parts.map((p, pIdx) => {
              const matchingPart = matchingSubShed.parts.find((sp: any) => 
                sp.id === p.id || 
                sp.name?.trim().toLowerCase() === p.name?.trim().toLowerCase() ||
                sp.order === pIdx
              );
              if (matchingPart && matchingPart.lines) {
                return {
                  ...p,
                  lines: p.lines.map((l, lIdx) => {
                    const matchingLine = matchingPart.lines.find((sl: any) => 
                      sl.id === l.id || 
                      sl.name?.trim().toLowerCase() === l.name?.trim().toLowerCase() ||
                      sl.order === lIdx
                    );
                    const subWeights = matchingLine && Array.isArray(matchingLine.weights) && matchingLine.weights.length > 0 ? matchingLine.weights : [];
                    return {
                      ...l,
                      weights: subWeights
                    };
                  })
                };
              }
              return p;
            })
          };
        }
        return s;
      });
    }
  } else {
    // UN-SUBMITTED: All lines MUST have weights: []
    mappedMemSheds = (memFarm.sheds || []).map((s: any) => ({
      ...s,
      parts: (s.parts || []).map((p: any) => ({
        ...p,
        lines: (p.lines || []).map((l: any) => ({
          ...l,
          weights: []
        }))
      }))
    }));
  }

  const formattedFarmSubs = farmSubs.map((s: any) => {
    const snapName = s.snapshotData?.farmName || s.metadata?.snapshotData?.farmName || s.metadata?.farmName || s.farmName || memFarm.name;
    return {
      ...s,
      farmName: snapName,
      snapshotData: {
        ...(s.snapshotData || s.metadata?.snapshotData || {}),
        farmName: snapName,
      }
    };
  });

  return res.json({
    ...memFarm,
    ageWeek: targetWeekMem || memFarm.ageWeek,
    sheds: mappedMemSheds,
    status: isCompleted ? 'COMPLETED' : (memFarm.status || 'DRAFT'),
    submissions: formattedFarmSubs,
    submissionCount: formattedFarmSubs.length,
    _count: { sheds: mappedMemSheds.length, submissions: formattedFarmSubs.length },
    audit,
  });
});

// --------------------------------------------------------------------------
// 3.B POST /api/database/clear-bird-weights - Reset bird weights fresh as new (Req 8)
// --------------------------------------------------------------------------
farmRouter.post('/database/clear-bird-weights', async (req: Request, res: Response) => {
  try {
    if (isPostgresConfigured()) {
      await prisma.birdWeight.deleteMany({});
      await prisma.submissionLine.deleteMany({});
      await prisma.submissionPart.deleteMany({});
      await prisma.submissionShed.deleteMany({});
      await prisma.submission.deleteMany({});
      try {
        await prisma.$executeRawUnsafe('UPDATE "Line" SET "weights" = ARRAY[]::float8[]');
      } catch {}
    }

    // Also clear memory store
    memoryBirdWeights.length = 0;
    memorySubmissions.length = 0;
    memoryFarms.forEach(f => {
      f.status = 'DRAFT';
      f.audit = undefined;
      f.sheds.forEach(s => {
        s.parts.forEach(p => {
          p.lines.forEach(l => {
            l.weights = [];
          });
        });
      });
    });

    return res.json({ success: true, message: 'All bird weights cleared fresh as new.' });
  } catch (err: any) {
    console.error('Error clearing bird weights:', err?.message || err);
    return res.status(503).json({ error: 'Server is not connected' });
  }
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
        return res.status(404).json({ error: 'Farm not found in database.' });
      }

      const authCheck = checkFarmAuthorization(user, existing.id, existing.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access Denied: You are not authorized to edit this farm.' });
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
      return sendSafe503(res, 'Not connected to server. Please try again.');
    }
  }

  // Memory fallback
  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });

  const authCheck = checkFarmAuthorization(user, memFarm.id, memFarm.name);
  if (!authCheck.authorized) {
    return res.status(403).json({ error: authCheck.error || 'Access Denied: You are not authorized to edit this farm.' });
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
      return sendSafe500(res, 'Failed to inspect farm deletion impact');
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

// Cascade-revoke user farm access when a farm is deleted or archived (Req 3)
async function revokeUserAccessForFarm(farmId: string, farmName?: string): Promise<void> {
  if (isPostgresConfigured()) {
    try {
      const orConditions: any[] = [{ assignedFarms: { has: farmId } }];
      if (farmName) {
        orConditions.push({ assignedFarms: { has: farmName } });
      }
      const affectedUsers = await prisma.user.findMany({
        where: { OR: orConditions }
      });
      for (const u of affectedUsers) {
        const rawAssigned: string[] = u.assignedFarms || [];
        const newAssigned = rawAssigned.filter(af => af !== farmId && af !== farmName);
        await prisma.user.update({
          where: { id: u.id },
          data: { assignedFarms: newAssigned }
        });
      }
    } catch (err) {
      console.warn('⚠️ [DB] Failed to revoke user assignments on farm deletion/archive:', err);
    }
  }

  // Always sync in-memory user list as well
  memoryUsers.forEach(u => {
    if (u.assignedFarms && u.assignedFarms.length > 0) {
      u.assignedFarms = u.assignedFarms.filter(af => af !== farmId && af !== farmName);
    }
  });
}

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
        return res.status(404).json({ error: 'Farm not found in database.' });
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

        // Cascade-revoke user farm access (Task 3)
        await revokeUserAccessForFarm(farmId, farm.name);

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

        // Cascade-revoke user farm access (Task 3)
        await revokeUserAccessForFarm(farmId, farm.name);

        return res.json({
          success: true,
          permanentlyDeleted: true,
          message: `Farm "${farm.name}" and all related data have been permanently deleted.`,
        });
      }
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete farm error:', err?.message || err);
      return sendSafe503(res, 'Not connected to server. Please try again.');
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
    await revokeUserAccessForFarm(farmId, memFarm.name);
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
    await revokeUserAccessForFarm(farmId, memFarm.name);
    return res.json({
      success: true,
      permanentlyDeleted: true,
      message: `Farm "${memFarm.name}" permanently deleted.`,
    });
  }
});

// --------------------------------------------------------------------------
// 5.B2 POST /api/farms/:id/archive - Safe Archive Farm (Admin only)
// --------------------------------------------------------------------------
farmRouter.post('/farms/:id/archive', async (req: Request, res: Response) => {
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  if (user.role !== 'Admin') {
    return res.status(403).json({ error: 'Access Denied: Only Administrator accounts can archive farms.' });
  }

  const farmId = req.params.id;

  if (isPostgresConfigured()) {
    try {
      const farm = await prisma.farm.findUnique({ where: { id: farmId } });
      if (!farm) {
        return res.status(404).json({ error: 'Farm not found in database.' });
      }

      const archived = await prisma.farm.update({
        where: { id: farmId },
        data: {
          isArchived: true,
          archivedAt: new Date(),
        }
      });

      // Cascade-revoke user farm access (Task 3)
      await revokeUserAccessForFarm(farmId, farm.name);

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
    } catch (err: any) {
      console.error('❌ [DB] Error archiving farm:', err?.message || err);
      return sendSafe503(res, 'Not connected to server. Please try again.');
    }
  }

  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });
  memFarm.isArchived = true;
  memFarm.archivedAt = new Date();
  await revokeUserAccessForFarm(farmId, memFarm.name);
  return res.json({
    success: true,
    archived: true,
    message: `Farm "${memFarm.name}" safely archived. Historical submissions remain preserved.`,
    farm: memFarm,
  });
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
      return sendSafe500(res, 'Failed to restore farm');
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
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const { farmId, name, type, order } = req.body;
  if (!farmId || !name || !String(name).trim()) {
    return res.status(400).json({ error: 'farmId and non-blank shed name required' });
  }

  const authCheck = checkFarmAuthorization(user, farmId);
  if (!authCheck.authorized) {
    return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
  }

  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;

  const trimmedName = String(name).trim();
  const shedId = crypto.randomUUID();
  const shedOrder = Number(order) || 1;
  const shedType = type === 'Male' ? 'Male' : 'Female';

  if (isPostgresConfigured()) {
    try {
      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot add shed: ${queryWeek} has already been submitted.` });
        }
      }

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
      return sendSafe503(res);
    }
  }

  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (!memFarm) return res.status(404).json({ error: 'Farm not found' });

  if (queryWeek) {
    const memCompleted = memorySubmissions.find(s => s.farmId === farmId && s.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && s.status === 'COMPLETED');
    if (memCompleted) {
      return res.status(400).json({ error: `Cannot add shed: ${queryWeek} has already been submitted.` });
    }
  }

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
// 7. DELETE /api/sheds/:shedId - Delete shed (Cascade deleting parts, lines & weights)
// --------------------------------------------------------------------------
farmRouter.delete('/sheds/:shedId', async (req: Request, res: Response) => {
  const shedId = req.params.shedId;
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;

  if (isPostgresConfigured()) {
    try {
      const shed = await prisma.shed.findUnique({
        where: { id: shedId },
        include: { farm: true }
      });
      if (!shed) {
        return res.status(404).json({ error: 'Shed not found in database' });
      }

      const authCheck = checkFarmAuthorization(user, shed.farmId, shed.farm?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot delete shed: ${queryWeek} has already been submitted.` });
        }
      }

      // Prisma cascade deletion cleanly deletes parts and lines belonging strictly to this shed
      await prisma.shed.delete({ where: { id: shedId } });
      await touchFarm(shed.farmId);
      return res.json({ success: true, deletedShedId: shedId });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete shed error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    const sIdx = farm.sheds.findIndex(s => s.id === shedId);
    if (sIdx !== -1) {
      const authCheck = checkFarmAuthorization(user, farm.id, farm.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }
      if (queryWeek) {
        const memCompleted = memorySubmissions.find(s => s.farmId === farm.id && s.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && s.status === 'COMPLETED');
        if (memCompleted) {
          return res.status(400).json({ error: `Cannot delete shed: ${queryWeek} has already been submitted.` });
        }
      }
      farm.sheds.splice(sIdx, 1);
      farm.updatedAt = new Date();
      return res.json({ success: true, deletedShedId: shedId });
    }
  }
  return res.status(404).json({ error: 'Shed not found' });
});

// --------------------------------------------------------------------------
// 8. PUT /api/sheds/:shedId - Edit shed name/type
// --------------------------------------------------------------------------
farmRouter.put('/sheds/:shedId', async (req: Request, res: Response) => {
  const shedId = req.params.shedId;
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const { name, type } = req.body;
  const validGender = type !== undefined ? (type === 'Male' ? 'Male' : 'Female') : undefined;
  const trimmedName = name !== undefined ? String(name).trim() : undefined;
  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;

  if (trimmedName !== undefined && trimmedName.length === 0) {
    return res.status(400).json({ error: 'Shed name cannot be blank.' });
  }

  if (isPostgresConfigured()) {
    try {
      const currentShed = await prisma.shed.findUnique({
        where: { id: shedId },
        include: { farm: true }
      });
      if (!currentShed) {
        return res.status(404).json({ error: 'Shed not found' });
      }

      const authCheck = checkFarmAuthorization(user, currentShed.farmId, currentShed.farm?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: currentShed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot rename shed: ${queryWeek} has already been submitted.` });
        }
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
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    const s = farm.sheds.find(shed => shed.id === shedId);
    if (s) {
      const authCheck = checkFarmAuthorization(user, farm.id, farm.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }
      if (queryWeek) {
        const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
        if (memCompleted) {
          return res.status(400).json({ error: `Cannot rename shed: ${queryWeek} has already been submitted.` });
        }
      }
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
// Helper validation functions for Parts A-D and Lines 1-16
const ALLOWED_PART_LETTERS = ['A', 'B', 'C', 'D'];

function validatePartLetter(name: string): { letter?: string; error?: string } {
  const clean = (name || '').trim();
  if (!clean) return { error: 'Part name is required.' };
  const withoutPart = clean.replace(/^part\s*[:\-]?\s*/i, '').trim();
  const candidate = (withoutPart || clean).toUpperCase();
  const letterMatch = candidate.match(/^[A-Z]/);
  if (!letterMatch) {
    return { error: 'Only Parts A, B, C, and D are allowed. Part E or higher is prohibited.' };
  }
  const letter = letterMatch[0];
  if (!ALLOWED_PART_LETTERS.includes(letter)) {
    return { error: `Only Parts A, B, C, and D are allowed. Part ${letter} is prohibited.` };
  }
  return { letter };
}

function validateLineNumber(name?: string, existingLines: { name: string }[] = []): { error?: string; num?: number; name?: string } {
  const existingNums = new Set(
    existingLines
      .map(l => {
        const m = l.name.match(/\d+/);
        return m ? parseInt(m[0], 10) : null;
      })
      .filter((n): n is number => n !== null && n >= 1 && n <= 16)
  );

  if (existingLines.length >= 16) {
    return { error: 'Maximum limit reached: A part can have at most 16 lines (Line 1 to Line 16).' };
  }

  if (name && name.trim()) {
    const match = name.match(/\d+/);
    if (!match) {
      return { error: 'Line identifier must be between Line 1 and Line 16.' };
    }
    const num = parseInt(match[0], 10);
    if (num < 1 || num > 16) {
      return { error: 'Line identifier must be between Line 1 and Line 16. Line 17 or higher is prohibited.' };
    }
    if (existingNums.has(num)) {
      return { error: `Line ${num} already exists in this part.` };
    }
    return { num, name: `Line ${num}` };
  }

  // Pick lowest available line number 1..16
  for (let i = 1; i <= 16; i++) {
    if (!existingNums.has(i)) {
      return { num: i, name: `Line ${i}` };
    }
  }

  return { error: 'Maximum limit reached: A part can have at most 16 lines (Line 1 to Line 16).' };
}

// --------------------------------------------------------------------------
// 9. POST /api/parts - Add part to shed (Enforcing Parts A–D, max 4)
// --------------------------------------------------------------------------
farmRouter.post('/parts', async (req: Request, res: Response) => {
  const { shedId, name, order } = req.body;
  if (!shedId || !name) return res.status(400).json({ error: 'shedId and name required' });

  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;
  const partVal = validatePartLetter(name);
  if (partVal.error || !partVal.letter) {
    return res.status(400).json({ error: partVal.error || 'Only Parts A, B, C, and D are allowed. Part E or higher is prohibited.' });
  }
  const formattedPartName = `Part ${partVal.letter}`;
  const partId = crypto.randomUUID();

  if (isPostgresConfigured()) {
    try {
      const shed = await prisma.shed.findUnique({
        where: { id: shedId },
        include: { farm: true, parts: true },
      });
      if (!shed) return res.status(404).json({ error: 'Shed not found' });

      const authCheck = checkFarmAuthorization(authUser, shed.farmId, (shed.farm as any)?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot modify parts: ${queryWeek} has already been submitted.` });
        }
      }

      if (shed.parts.length >= 4) {
        return res.status(400).json({ error: 'Maximum limit reached: A shed can have at most 4 parts (Parts A–D).' });
      }

      const duplicate = shed.parts.some(p => p.name.trim().toLowerCase() === formattedPartName.toLowerCase());
      if (duplicate) {
        return res.status(400).json({ error: `${formattedPartName} already exists in this shed.` });
      }

      const newPart = await prisma.part.create({
        data: {
          id: partId,
          shedId,
          name: formattedPartName,
          order: order || shed.parts.length + 1,
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
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    const s = farm.sheds.find(shed => shed.id === shedId);
    if (s) {
      const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
        if (memCompleted) {
          return res.status(400).json({ error: `Cannot modify parts: ${queryWeek} has already been submitted.` });
        }
      }

      if (s.parts.length >= 4) {
        return res.status(400).json({ error: 'Maximum limit reached: A shed can have at most 4 parts (Parts A–D).' });
      }

      const duplicate = s.parts.some(p => p.name.trim().toLowerCase() === formattedPartName.toLowerCase());
      if (duplicate) {
        return res.status(400).json({ error: `${formattedPartName} already exists in this shed.` });
      }

      const newMemPart: MemPart = {
        id: partId,
        shedId,
        name: formattedPartName,
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
  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;

  if (isPostgresConfigured()) {
    try {
      const part = await prisma.part.findUnique({
        where: { id: partId },
        include: { shed: { include: { farm: true, parts: true } } },
      });
      if (!part) {
        return res.status(404).json({ error: 'Part not found in database' });
      }

      const authCheck = checkFarmAuthorization(authUser, part.shed.farmId, part.shed.farm?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: part.shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot delete part: ${queryWeek} has already been submitted.` });
        }
      }

      if (part.shed.parts.length <= 1) {
        return res.status(400).json({ error: 'Cannot delete part: A shed must have at least 1 part.' });
      }

      await prisma.part.delete({ where: { id: partId } });
      await touchFarm(part.shed.farmId);
      return res.json({ success: true });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete part error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      const pIdx = shed.parts.findIndex(p => p.id === partId);
      if (pIdx !== -1) {
        const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
        if (!authCheck.authorized) {
          return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
        }

        if (queryWeek) {
          const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
          if (memCompleted) {
            return res.status(400).json({ error: `Cannot delete part: ${queryWeek} has already been submitted.` });
          }
        }

        if (shed.parts.length <= 1) {
          return res.status(400).json({ error: 'Cannot delete part: A shed must have at least 1 part.' });
        }

        shed.parts.splice(pIdx, 1);
        farm.updatedAt = new Date();
        return res.json({ success: true });
      }
    }
  }
  return res.status(404).json({ error: 'Part not found' });
});

// --------------------------------------------------------------------------
// 11. PUT /api/parts/:partId - Rename part (Enforcing Parts A–D)
// --------------------------------------------------------------------------
farmRouter.put('/parts/:partId', async (req: Request, res: Response) => {
  const partId = req.params.partId;
  const { name } = req.body;
  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;
  const partVal = validatePartLetter(name);
  if (partVal.error || !partVal.letter) {
    return res.status(400).json({ error: partVal.error || 'Only Parts A, B, C, and D are allowed. Part E or higher is prohibited.' });
  }
  const formattedPartName = `Part ${partVal.letter}`;

  if (isPostgresConfigured()) {
    try {
      const part = await prisma.part.findUnique({
        where: { id: partId },
        include: { shed: { include: { farm: true, parts: true } } },
      });
      if (!part) return res.status(404).json({ error: 'Part not found' });

      const authCheck = checkFarmAuthorization(authUser, part.shed.farmId, part.shed.farm?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: part.shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot rename part: ${queryWeek} has already been submitted.` });
        }
      }

      const duplicate = part.shed.parts.some(p => p.id !== partId && p.name.trim().toLowerCase() === formattedPartName.toLowerCase());
      if (duplicate) {
        return res.status(400).json({ error: `${formattedPartName} already exists in this shed.` });
      }

      const updated = await prisma.part.update({
        where: { id: partId },
        data: { name: formattedPartName },
        include: { shed: true },
      });
      await touchFarm(updated.shed.farmId);
      return res.json(updated);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL rename part error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      const p = shed.parts.find(part => part.id === partId);
      if (p) {
        const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
        if (!authCheck.authorized) {
          return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
        }

        if (queryWeek) {
          const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
          if (memCompleted) {
            return res.status(400).json({ error: `Cannot rename part: ${queryWeek} has already been submitted.` });
          }
        }

        const duplicate = shed.parts.some(other => other.id !== partId && other.name.trim().toLowerCase() === formattedPartName.toLowerCase());
        if (duplicate) {
          return res.status(400).json({ error: `${formattedPartName} already exists in this shed.` });
        }

        p.name = formattedPartName;
        farm.updatedAt = new Date();
        return res.json(p);
      }
    }
  }
  return res.status(404).json({ error: 'Part not found' });
});

// --------------------------------------------------------------------------
// 12. POST /api/lines - Add line to part (Enforcing Lines 1–16, max 16)
// --------------------------------------------------------------------------
farmRouter.post('/lines', async (req: Request, res: Response) => {
  const { partId, name } = req.body;
  if (!partId) return res.status(400).json({ error: 'partId required' });
  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;
  const lineId = crypto.randomUUID();

  if (isPostgresConfigured()) {
    try {
      const part = await prisma.part.findUnique({
        where: { id: partId },
        include: { shed: { include: { farm: true } }, lines: true },
      });
      if (!part) return res.status(404).json({ error: 'Part not found' });

      const authCheck = checkFarmAuthorization(authUser, part.shed.farmId, (part.shed.farm as any)?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: part.shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot modify lines: ${queryWeek} has already been submitted.` });
        }
      }

      const lineValidation = validateLineNumber(name, part.lines);
      if (lineValidation.error) {
        return res.status(400).json({ error: lineValidation.error });
      }
      const lineName = lineValidation.name || 'Line 1';

      const newLine = await prisma.line.create({
        data: {
          id: lineId,
          partId,
          name: lineName,
          weights: [],
        },
        include: { part: { include: { shed: true } } },
      });
      await touchFarm(newLine.part.shed.farmId);
      return res.status(201).json(newLine);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL create line error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      const p = shed.parts.find(part => part.id === partId);
      if (p) {
        const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
        if (!authCheck.authorized) {
          return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
        }

        if (queryWeek) {
          const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
          if (memCompleted) {
            return res.status(400).json({ error: `Cannot modify lines: ${queryWeek} has already been submitted.` });
          }
        }

        const lineValidation = validateLineNumber(name, p.lines);
        if (lineValidation.error) {
          return res.status(400).json({ error: lineValidation.error });
        }
        const lineName = lineValidation.name || 'Line 1';

        const newLine: MemLine = {
          id: lineId,
          partId,
          name: lineName,
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
  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;

  if (isPostgresConfigured()) {
    try {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: { include: { farm: true } }, lines: true } } },
      });
      if (!line) {
        return res.status(404).json({ error: 'Line not found in database' });
      }

      const authCheck = checkFarmAuthorization(authUser, line.part.shed.farmId, line.part.shed.farm?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: line.part.shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot delete line: ${queryWeek} has already been submitted.` });
        }
      }

      if (line.part.lines.length <= 1) {
        return res.status(400).json({ error: 'Cannot delete line: A part must have at least 1 pen line.' });
      }

      await prisma.line.delete({ where: { id: lineId } });
      await touchFarm(line.part.shed.farmId);
      return res.json({ success: true });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete line error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      for (const part of shed.parts) {
        const lIdx = part.lines.findIndex(l => String(l.id) === String(lineId));
        if (lIdx !== -1) {
          const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
          if (!authCheck.authorized) {
            return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
          }

          if (queryWeek) {
            const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
            if (memCompleted) {
              return res.status(400).json({ error: `Cannot delete line: ${queryWeek} has already been submitted.` });
            }
          }

          if (part.lines.length <= 1) {
            return res.status(400).json({ error: 'Cannot delete line: A part must have at least 1 pen line.' });
          }

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
  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const weight = parseFloat(req.body.weight);
  const userName = req.body.userName?.trim() || authUser.name || 'Weighing Supervisor';
  const userId = req.body.userId || authUser.id || null;
  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;

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
        return res.status(404).json({ error: 'Line not found in database' });
      }

      const authCheck = checkFarmAuthorization(authUser, line.part.shed.farmId, line.part.shed.farm?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: line.part.shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot add weights: ${queryWeek} has already been submitted.` });
        }
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
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      for (const part of shed.parts) {
        const l = part.lines.find(line => String(line.id) === String(lineId));
        if (l) {
          const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
          if (!authCheck.authorized) {
            return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
          }

          if (queryWeek) {
            const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
            if (memCompleted) {
              return res.status(400).json({ error: `Cannot add weights: ${queryWeek} has already been submitted.` });
            }
          }

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
  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const index = parseInt(req.params.index, 10);
  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;

  if (isNaN(index) || index < 0) {
    return res.status(400).json({ error: 'Valid index required' });
  }

  if (isPostgresConfigured()) {
    try {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: { include: { farm: true } } } } },
      });
      if (!line) {
        return res.status(404).json({ error: 'Line not found in database' });
      }

      const authCheck = checkFarmAuthorization(authUser, line.part.shed.farmId, line.part.shed.farm?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: line.part.shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot delete weight: ${queryWeek} has already been submitted.` });
        }
      }

      if (index < line.weights.length) {
        const updatedWeights = [...line.weights];
        updatedWeights.splice(index, 1);
        const updated = await prisma.line.update({
          where: { id: lineId },
          data: { weights: { set: updatedWeights } },
        });
        await touchFarm(line.part.shed.farmId);
        return res.json(updated);
      }
      return res.status(404).json({ error: 'Weight index not found in line' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete weight error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      for (const part of shed.parts) {
        const l = part.lines.find(line => String(line.id) === String(lineId));
        if (l) {
          const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
          if (!authCheck.authorized) {
            return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
          }

          if (queryWeek) {
            const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
            if (memCompleted) {
              return res.status(400).json({ error: `Cannot delete weight: ${queryWeek} has already been submitted.` });
            }
          }

          if (index < l.weights.length) {
            l.weights.splice(index, 1);
            farm.updatedAt = new Date();
            return res.json(l);
          }
          return res.status(404).json({ error: 'Weight index not found' });
        }
      }
    }
  }
  return res.status(404).json({ error: 'Line not found' });
});

// --------------------------------------------------------------------------
// 16. POST /api/lines/:lineId/clear - Clear all weights in a line
// --------------------------------------------------------------------------
farmRouter.post('/lines/:lineId/clear', async (req: Request, res: Response) => {
  const lineId = req.params.lineId;
  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const queryWeek = (req.query.week || req.body?.week || req.query.flockAge || req.body?.flockAge) as string | undefined;

  if (isPostgresConfigured()) {
    try {
      const line = await prisma.line.findUnique({
        where: { id: lineId },
        include: { part: { include: { shed: { include: { farm: true } } } } },
      });
      if (!line) {
        return res.status(404).json({ error: 'Line not found in database' });
      }

      const authCheck = checkFarmAuthorization(authUser, line.part.shed.farmId, line.part.shed.farm?.name);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
      }

      if (queryWeek) {
        const completedSub = await prisma.submission.findFirst({
          where: {
            farmId: line.part.shed.farmId,
            flockAge: queryWeek.trim().toUpperCase(),
            status: 'COMPLETED'
          }
        });
        if (completedSub) {
          return res.status(400).json({ error: `Cannot clear line weights: ${queryWeek} has already been submitted.` });
        }
      }

      const updated = await prisma.line.update({
        where: { id: lineId },
        data: { weights: { set: [] } },
      });
      await touchFarm(line.part.shed.farmId);
      return res.json(updated);
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL clear line error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  for (const farm of memoryFarms) {
    for (const shed of farm.sheds) {
      for (const part of shed.parts) {
        const l = part.lines.find(line => String(line.id) === String(lineId));
        if (l) {
          const authCheck = checkFarmAuthorization(authUser, farm.id, farm.name);
          if (!authCheck.authorized) {
            return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
          }

          if (queryWeek) {
            const memCompleted = memorySubmissions.find(sub => sub.farmId === farm.id && sub.flockAge?.trim().toUpperCase() === queryWeek.trim().toUpperCase() && sub.status === 'COMPLETED');
            if (memCompleted) {
              return res.status(400).json({ error: `Cannot clear line weights: ${queryWeek} has already been submitted.` });
            }
          }

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
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const authCheck = checkFarmAuthorization(user, farmId, req.body?.name);
  if (!authCheck.authorized) {
    return res.status(403).json({ error: authCheck.error || 'Access denied to unassigned farm.' });
  }

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
        // Query existing sheds with parts and lines to safely update without dropping data
        const existingSheds = await prisma.shed.findMany({
          where: { farmId },
          include: { parts: { include: { lines: true } } },
        });

        for (let sIdx = 0; sIdx < sheds.length; sIdx++) {
          const s = sheds[sIdx];
          const existingShed = existingSheds.find(es =>
            (s.id && es.id === s.id) ||
            (s.name && es.name && es.name.trim().toLowerCase() === s.name.trim().toLowerCase())
          );

          let shedId = existingShed?.id || s.id || crypto.randomUUID();
          if (existingShed) {
            await prisma.shed.update({
              where: { id: existingShed.id },
              data: {
                name: s.name,
                type: s.type || existingShed.type || 'Female',
                order: sIdx + 1,
              },
            });
          } else {
            const createdShed = await prisma.shed.create({
              data: {
                id: shedId,
                farmId,
                name: s.name,
                type: s.type || 'Female',
                order: sIdx + 1,
              },
            });
            shedId = createdShed.id;
          }

          if (Array.isArray(s.parts)) {
            const existingParts = existingShed?.parts || [];
            for (let pIdx = 0; pIdx < s.parts.length; pIdx++) {
              const p = s.parts[pIdx];
              const existingPart = existingParts.find(ep =>
                (p.id && ep.id === p.id) ||
                (p.name && ep.name && ep.name.trim().toLowerCase() === p.name.trim().toLowerCase())
              );

              let partId = existingPart?.id || p.id || crypto.randomUUID();
              if (existingPart) {
                await prisma.part.update({
                  where: { id: existingPart.id },
                  data: {
                    name: p.name,
                    order: pIdx + 1,
                  },
                });
              } else {
                const createdPart = await prisma.part.create({
                  data: {
                    id: partId,
                    shedId,
                    name: p.name,
                    order: pIdx + 1,
                  },
                });
                partId = createdPart.id;
              }

              if (Array.isArray(p.lines)) {
                const existingLines = existingPart?.lines || [];
                for (const l of p.lines) {
                  const existingLine = existingLines.find(el =>
                    (l.id && String(el.id) === String(l.id)) ||
                    (l.name && el.name && el.name.trim().toLowerCase() === l.name.trim().toLowerCase())
                  );

                  // If incoming line has weights, update them.
                  // If incoming line was explicitly cleared or deleted to empty (clearedAt is present), clear weights to [].
                  // If incoming weights are empty and line was NOT cleared, preserve existing weights (unweighed line safety).
                  const incomingWeights = Array.isArray(l.weights) && l.weights.length > 0 ? l.weights : [];
                  const isExplicitClear = Boolean((l as any).clearedAt || (l as any).isCleared);
                  if (existingLine) {
                    let finalWeights = existingLine.weights;
                    if (incomingWeights.length > 0) {
                      finalWeights = incomingWeights;
                    } else if (isExplicitClear) {
                      finalWeights = [];
                    }
                    await prisma.line.update({
                      where: { id: existingLine.id },
                      data: {
                        name: l.name,
                        weights: finalWeights,
                      },
                    });
                  } else {
                    await prisma.line.create({
                      data: {
                        id: String(l.id || crypto.randomUUID()),
                        partId,
                        name: l.name,
                        weights: incomingWeights,
                      },
                    });
                  }
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
      return sendSafe503(res);
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
    if (Array.isArray(sheds)) {
      const existingSheds = memFarm.sheds || [];
      memFarm.sheds = sheds.map((s: any) => {
        const exShed = existingSheds.find((es: any) => es.id === s.id || (es.name && s.name && es.name.trim().toLowerCase() === s.name.trim().toLowerCase()));
        if (!exShed) return s;
        const mergedParts = (s.parts || []).map((p: any) => {
          const exPart = (exShed.parts || []).find((ep: any) => ep.id === p.id || (ep.name && p.name && ep.name.trim().toLowerCase() === p.name.trim().toLowerCase()));
          if (!exPart) return p;
          const mergedLines = (p.lines || []).map((l: any) => {
            const exLine = (exPart.lines || []).find((el: any) => String(el.id) === String(l.id) || (el.name && l.name && el.name.trim().toLowerCase() === l.name.trim().toLowerCase()));
            if (!exLine) return l;
            const incW = Array.isArray(l.weights) && l.weights.length > 0 ? l.weights : [];
            const exW = Array.isArray(exLine.weights) && exLine.weights.length > 0 ? exLine.weights : [];
            return { ...l, weights: incW.length > 0 ? incW : exW };
          });
          return { ...p, lines: mergedLines };
        });
        return { ...s, parts: mergedParts };
      });
    }
    if (audit) (memFarm as any).audit = audit;
    memFarm.updatedAt = now;
  }

  return res.json(memFarm);
});

// --------------------------------------------------------------------------
// Helper: Get next sequential Employee Code (e.g. EMP0001, EMP0002...)
// --------------------------------------------------------------------------
export async function getNextEmployeeCode(): Promise<string> {
  let highestNum = 0;

  if (isPostgresConfigured()) {
    try {
      const users = await prisma.user.findMany({ select: { username: true } });
      for (const u of users) {
        const match = u.username.match(/^EMP(\d+)$/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > highestNum) highestNum = num;
        }
      }
    } catch {}
  }

  for (const u of memoryUsers) {
    const code = u.employeeCode || u.username;
    const match = code.match(/^EMP(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > highestNum) highestNum = num;
    }
  }

  const nextNum = Math.max(highestNum + 1, 1);
  return `EMP${String(nextNum).padStart(4, '0')}`;
}

// --------------------------------------------------------------------------
// 17b. GET /api/auth/next-employee-code - Query Next Available Employee Code
// --------------------------------------------------------------------------
farmRouter.get('/auth/next-employee-code', async (_req: Request, res: Response) => {
  const code = await getNextEmployeeCode();
  return res.json({ nextEmployeeCode: code });
});

// --------------------------------------------------------------------------
// 18. POST /api/auth/login - Secure User Sign In (Supports Username or Employee Code)
// --------------------------------------------------------------------------
farmRouter.post('/auth/login', async (req: Request, res: Response) => {
  const rawInput = String(req.body.username || req.body.email || req.body.employeeCode || req.body.employeeId || '').trim();
  const password = String(req.body.password || '');

  if (!rawInput || !password) {
    return res.status(400).json({ error: 'Username or Employee Code and password are required' });
  }

  const rateKey = rawInput.toLowerCase();
  const rateCheck = checkRateLimit(rateKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({ 
      error: `Too many failed login attempts. Please wait ${rateCheck.waitSeconds} seconds before trying again.` 
    });
  }

  const upperInput = rawInput.toUpperCase();
  const lowerInput = rawInput.toLowerCase();

  if (isPostgresConfigured()) {
    try {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: rawInput, mode: 'insensitive' } },
            { username: { equals: upperInput, mode: 'insensitive' } },
            { email: { equals: lowerInput, mode: 'insensitive' } },
          ]
        }
      });

      if (!user || !verifyPassword(password, user.password)) {
        recordFailedLogin(rateKey);
        return res.status(401).json({ error: 'Invalid username/employee code or password.' });
      }

      if (user.status === 'INACTIVE' || user.status === 'DEACTIVATED' || user.status === 'DELETED') {
        return res.status(403).json({ error: 'Account is deactivated. Please contact your Administrator.' });
      }

      clearRateLimit(rateKey);
      const token = generateToken({ id: user.id, username: user.username, role: user.role });
      const userRequiresPwChange = !!(user as any).requiresPasswordChange;
      return res.json({
        token,
        requiresPasswordChange: userRequiresPwChange,
        user: {
          id: user.id,
          username: user.username,
          employeeCode: (user as any).employeeCode || (user.username.startsWith('EMP') ? user.username : undefined),
          phone: (user as any).phone,
          requiresPasswordChange: userRequiresPwChange,
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
      return sendSafe503(res);
    }
  }

  // Memory fallback only for local offline simulation
  const memUser = memoryUsers.find(u => 
    u.username.toLowerCase() === lowerInput || 
    (u.employeeCode && u.employeeCode.toUpperCase() === upperInput) ||
    (u.username.toUpperCase() === upperInput) ||
    (u.email && u.email.toLowerCase() === lowerInput)
  );

  if (!memUser || !verifyPassword(password, memUser.password)) {
    recordFailedLogin(rateKey);
    return res.status(401).json({ error: 'Invalid username/employee code or password.' });
  }

  if (memUser.status === 'INACTIVE' || memUser.status === 'DEACTIVATED' || memUser.status === 'DELETED') {
    return res.status(403).json({ error: 'Account is deactivated. Please contact your Administrator.' });
  }

  clearRateLimit(rateKey);
  const token = generateToken({ id: memUser.id, username: memUser.username, role: memUser.role });
  const requiresPwChange = !!memUser.requiresPasswordChange;
  return res.json({
    token,
    requiresPasswordChange: requiresPwChange,
    user: {
      id: memUser.id,
      username: memUser.username,
      employeeCode: memUser.employeeCode || (memUser.username.startsWith('EMP') ? memUser.username : undefined),
      phone: memUser.phone,
      requiresPasswordChange: requiresPwChange,
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
            employeeCode: (user as any).employeeCode || (user.username.startsWith('EMP') ? user.username : undefined),
            phone: (user as any).phone,
            requiresPasswordChange: !!(user as any).requiresPasswordChange,
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
        employeeCode: memUser.employeeCode || (memUser.username.startsWith('EMP') ? memUser.username : undefined),
        phone: memUser.phone,
        requiresPasswordChange: !!memUser.requiresPasswordChange,
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
        where: {
          status: { notIn: ['DEACTIVATED', 'DELETED'] }
        },
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
      return res.json(users.map(u => ({
        ...u,
        employeeCode: (u as any).employeeCode || (u.username.startsWith('EMP') ? u.username : undefined),
        phone: (u as any).phone,
        requiresPasswordChange: !!(u as any).requiresPasswordChange,
      })));
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL get users error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  return res.json(
    memoryUsers
      .filter(u => u.status !== 'DEACTIVATED' && u.status !== 'DELETED')
      .map(u => ({
        id: u.id,
        username: u.username,
        employeeCode: u.employeeCode || (u.username.startsWith('EMP') ? u.username : undefined),
        phone: u.phone,
        requiresPasswordChange: !!u.requiresPasswordChange,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        assignedFarms: u.assignedFarms || [],
        createdAt: u.createdAt,
      }))
  );
});


// --------------------------------------------------------------------------
// 21b. POST /api/auth/change-password - First-Login or Self Password Update
// --------------------------------------------------------------------------
farmRouter.post('/auth/change-password', async (req: Request, res: Response) => {
  const user = await getAuthUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required to update password.' });
  }

  const { newPassword } = req.body;
  const cleanNew = String(newPassword || '').trim();
  if (!cleanNew || cleanNew.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  const hashedPassword = hashPassword(cleanNew);

  if (isPostgresConfigured()) {
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });
      try {
        await prisma.$executeRawUnsafe(
          'UPDATE "User" SET "requiresPasswordChange" = false WHERE "id" = $1',
          user.id
        );
      } catch {}
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL change password error:', err?.message || err);
      return sendSafe503(res, 'Database error');
    }
  }

  const memUser = memoryUsers.find(u => u.id === user.id || u.username.toLowerCase() === user.username.toLowerCase());
  if (memUser) {
    memUser.password = hashedPassword;
    memUser.requiresPasswordChange = false;
  }

  const newToken = generateToken({ id: user.id, username: user.username, role: user.role });
  return res.json({
    success: true,
    message: 'Password changed successfully.',
    token: newToken,
    user: {
      ...user,
      requiresPasswordChange: false,
    },
  });
});

// --------------------------------------------------------------------------
// 22. POST /api/auth/users - Create User Account (Admin & Manager)
// --------------------------------------------------------------------------
farmRouter.post('/auth/users', async (req: Request, res: Response) => {
  const { name, role, assignedFarms, phone } = req.body;
  let inputUsername = req.body.username || req.body.employeeCode || req.body.employeeId;
  let inputPassword = req.body.password;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }

  const cleanName = String(name).trim();
  const validRoles = ['Admin', 'Manager', 'Supervisor', 'In-Charge'];
  const userRole = validRoles.includes(role) ? role : 'Supervisor';
  const farmList = Array.isArray(assignedFarms) ? assignedFarms : [];

  let employeeCode: string | undefined;
  const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
  let requiresPasswordChange = false;

  // Auto-generate employee code for Supervisor and In-Charge
  if (userRole === 'Supervisor' || userRole === 'In-Charge') {
    employeeCode = await getNextEmployeeCode();
    // Default username to generated employeeCode if not provided
    if (!inputUsername || !String(inputUsername).trim()) {
      inputUsername = employeeCode;
    }

    // Auto-derive initial temporary password from phone: first 3 + last 3 digits
    if (cleanPhone && cleanPhone.length >= 6) {
      inputPassword = cleanPhone.slice(0, 3) + cleanPhone.slice(-3);
      requiresPasswordChange = true;
    } else if (!inputPassword || !String(inputPassword).trim()) {
      return res.status(400).json({ 
        error: 'A registered phone number (at least 6 digits) is required to generate the initial password.' 
      });
    }
  } else {
    // Admin / Manager
    if (!inputUsername || !String(inputUsername).trim()) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (!inputPassword || !String(inputPassword).trim()) {
      return res.status(400).json({ error: 'Password is required.' });
    }
  }

  const cleanUsername = String(inputUsername).trim();
  const hashedPassword = hashPassword(String(inputPassword).trim());

  if (isPostgresConfigured()) {
    try {
      const existing = await prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: cleanUsername, mode: 'insensitive' as const } },
            ...(employeeCode ? [{ username: { equals: employeeCode, mode: 'insensitive' as const } }] : [])
          ]
        }
      });
      if (existing) {
        return res.status(409).json({ error: `Username or Employee Code "${cleanUsername}" is already taken.` });
      }

      const created = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          username: cleanUsername,
          name: cleanName,
          email: `${cleanUsername.toLowerCase()}@farm.local`,
          password: hashedPassword,
          role: userRole,
          status: 'ACTIVE',
          assignedFarms: farmList,
        }
      });

      // Save additional columns safely
      try {
        if (employeeCode || cleanPhone || requiresPasswordChange) {
          await prisma.$executeRawUnsafe(
            'UPDATE "User" SET "employeeCode" = $1, "phone" = $2, "requiresPasswordChange" = $3 WHERE "id" = $4',
            employeeCode || null,
            cleanPhone || null,
            requiresPasswordChange,
            created.id
          );
        }
      } catch {}

      return res.status(201).json({
        id: created.id,
        username: created.username,
        employeeCode: employeeCode || (created.username.startsWith('EMP') ? created.username : undefined),
        phone: cleanPhone || undefined,
        requiresPasswordChange,
        name: created.name,
        role: created.role,
        status: created.status,
        assignedFarms: created.assignedFarms,
        createdAt: created.createdAt,
      });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL create user error:', err?.message || err);
      return sendSafe503(res);
    }
  }

  const existingMem = memoryUsers.find(u => 
    u.username.toLowerCase() === cleanUsername.toLowerCase() ||
    (employeeCode && u.employeeCode && u.employeeCode.toUpperCase() === employeeCode.toUpperCase())
  );
  if (existingMem) {
    return res.status(409).json({ error: `Username or Employee Code "${cleanUsername}" is already taken.` });
  }

  const newMemUser: MemUser = {
    id: `u-${Date.now()}`,
    username: cleanUsername,
    employeeCode,
    phone: cleanPhone || undefined,
    requiresPasswordChange,
    name: cleanName,
    email: `${cleanUsername.toLowerCase()}@farm.local`,
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
    employeeCode: newMemUser.employeeCode,
    phone: newMemUser.phone,
    requiresPasswordChange: newMemUser.requiresPasswordChange,
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
      return sendSafe503(res);
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
      return res.json({ success: true, message: 'Password reset successfully in database' });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL reset password error:', err?.message || err);
      return sendSafe503(res);
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
// 25. DELETE /api/auth/users/:id - Delete User Account (Admin Only, Safe Deletion)
// --------------------------------------------------------------------------
farmRouter.delete('/auth/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  // 1. Verify authentication
  const authUser = await getAuthUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in as Administrator.' });
  }

  // 2. Enforce strict Admin authorization (Supervisors and Incharges are strictly forbidden)
  if (authUser.role !== 'Admin') {
    return res.status(403).json({ error: 'Permission Denied: Only Administrator accounts can delete employee accounts.' });
  }

  // 3. Prevent self-deletion of currently logged-in Administrator
  if (authUser.id === id || authUser.username.toLowerCase() === id.toLowerCase()) {
    return res.status(400).json({ error: 'Security Restriction: You cannot delete your own currently logged-in Administrator account.' });
  }

  // 4. Prevent deletion of default protected primary system administrator
  if (id === 'u-admin-1' || id.toLowerCase() === 'admin') {
    return res.status(400).json({ error: 'Security Restriction: The primary system Administrator account is protected and cannot be deleted.' });
  }

  if (isPostgresConfigured()) {
    try {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { id },
            { username: { equals: id, mode: 'insensitive' as const } }
          ]
        }
      });

      if (!user) {
        return res.status(404).json({ error: 'User account not found.' });
      }

      if (user.username.toLowerCase() === 'admin') {
        return res.status(400).json({ error: 'Security Restriction: The primary system Administrator account is protected and cannot be deleted.' });
      }

      if (user.id === authUser.id) {
        return res.status(400).json({ error: 'Security Restriction: You cannot delete your own currently logged-in Administrator account.' });
      }

      if (user.role === 'Admin') {
        const adminCount = await prisma.user.count({ where: { role: 'Admin', status: { notIn: ['DEACTIVATED', 'DELETED'] } } });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Security Restriction: Cannot delete the sole Administrator account on the system.' });
        }
      }

      // Detach user from historical Submissions and ActivityLogs to preserve historical audit data
      await prisma.submission.updateMany({
        where: { userId: user.id },
        data: { userId: null }
      }).catch(() => {});

      await prisma.activityLog.updateMany({
        where: { userId: user.id },
        data: { userId: null }
      }).catch(() => {});

      // Delete user record from database, falling back to safe deactivation if database constraints require it
      try {
        await prisma.user.delete({ where: { id: user.id } });
      } catch (delErr: any) {
        console.warn('⚠️ [DB] Prisma hard delete constraint, applying safe deactivation:', delErr?.message);
        await prisma.user.update({
          where: { id: user.id },
          data: {
            status: 'DEACTIVATED',
            assignedFarms: [],
            password: hashPassword(`DEACTIVATED_${Date.now()}`),
          }
        });
      }

      return res.json({ 
        success: true, 
        message: `Employee account for ${user.name} (@${user.username}) deleted successfully.` 
      });
    } catch (err: any) {
      console.error('❌ [DB] PostgreSQL delete user error:', err?.message || err);
      return sendSafe500(res, 'An error occurred while deleting user account.');
    }
  }

  // In-Memory Mode (Local / Offline)
  const idx = memoryUsers.findIndex(u => u.id === id || u.username.toLowerCase() === id.toLowerCase());
  if (idx === -1) {
    return res.status(404).json({ error: 'User account not found.' });
  }

  const targetUser = memoryUsers[idx];

  if (targetUser.username.toLowerCase() === 'admin') {
    return res.status(400).json({ error: 'Security Restriction: The primary system Administrator account is protected and cannot be deleted.' });
  }

  if (targetUser.id === authUser.id) {
    return res.status(400).json({ error: 'Security Restriction: You cannot delete your own currently logged-in Administrator account.' });
  }

  if (targetUser.role === 'Admin') {
    const adminCount = memoryUsers.filter(u => u.role === 'Admin' && u.status !== 'DEACTIVATED' && u.status !== 'DELETED').length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Security Restriction: Cannot delete the sole Administrator account on the system.' });
    }
  }

  // Remove operator from all assigned farms in memoryFarms
  for (const farm of memoryFarms) {
    if (farm.assignedOperators) {
      farm.assignedOperators = farm.assignedOperators.filter((opId: string) => opId !== targetUser.id && opId !== targetUser.username);
    }
    if (farm.assignedUserNames) {
      farm.assignedUserNames = farm.assignedUserNames.filter((uName: string) => uName !== targetUser.name && uName !== targetUser.username);
    }
  }

  // Detach userId in memoryLogs to preserve historical records
  for (const log of memoryLogs) {
    if (log.userId === targetUser.id) {
      log.userId = undefined;
    }
  }

  // Remove user from active memoryUsers
  memoryUsers.splice(idx, 1);

  return res.json({ 
    success: true, 
    message: `Employee account for ${targetUser.name} (@${targetUser.username}) deleted successfully.` 
  });
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
      return sendSafe503(res);
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
      return sendSafe503(res);
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
