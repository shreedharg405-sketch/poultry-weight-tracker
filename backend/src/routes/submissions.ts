import { Router, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db/prisma.js';
import { requireAuth, canUserAccessFarm, AuthenticatedRequest } from '../middleware/auth.js';
import { checkDb, memoryFarms, memoryLogs } from './farms.js';

export const submissionRouter = Router();

// In-Memory store for submissions and bird weights when PostgreSQL is not connected
export interface MemSubmission {
  id: string;
  idempotencyKey?: string | null;
  farmId: string;
  farmName: string;
  userId?: string | null;
  submitterName: string;
  submitterRole: string;
  flockAge: string;
  season: string;
  status: 'DRAFT' | 'UPLOADING' | 'COMPLETED' | 'UPLOAD_FAILED';
  totalBirds: number;
  femaleAvgWeight?: number | null;
  maleAvgWeight?: number | null;
  overallAvgWeight?: number | null;
  uniformity?: number | null;
  metadata?: any;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  sheds: any[];
}

export interface MemBirdWeight {
  id: string;
  submissionId: string;
  submissionLineId: string;
  farmId: string;
  shedName: string;
  partName: string;
  lineName: string;
  sex: string;
  sampleSequence: number;
  weightGrams: number;
  createdAt: Date;
}

export const memorySubmissions: MemSubmission[] = [];
export const memoryBirdWeights: MemBirdWeight[] = [];

// Helper to calculate uniformity percentage (+/- 10% from mean)
function calculateUniformity(weights: number[]): { avg: number; uniformity: number } {
  if (weights.length === 0) return { avg: 0, uniformity: 0 };
  const sum = weights.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / weights.length);
  const lower = avg * 0.9;
  const upper = avg * 1.1;
  const inRange = weights.filter(w => w >= lower && w <= upper).length;
  const uniformity = Math.round((inRange / weights.length) * 1000) / 10;
  return { avg, uniformity };
}

// --------------------------------------------------------------------------
// 1. POST /api/submissions - Submit & Upload Batch Weighing
// --------------------------------------------------------------------------
submissionRouter.post('/submissions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { 
    idempotencyKey, 
    farmId, 
    flockAge, 
    season, 
    sheds, 
    metadata 
  } = req.body;

  if (!farmId) {
    return res.status(400).json({ error: 'Farm ID is required for submission.' });
  }

  // 1. Idempotency Check: Prevent duplicate submissions on retries
  if (idempotencyKey && idempotencyKey.trim()) {
    try {
      if (await checkDb()) {
        const existing = await prisma.submission.findUnique({
          where: { idempotencyKey: idempotencyKey.trim() },
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
        });
        if (existing) {
          return res.status(200).json({
            success: true,
            status: existing.status,
            message: 'Batch weighing already committed to cloud database.',
            submission: existing,
            isIdempotentReplay: true,
          });
        }
      }
    } catch (e) {
      console.warn('Idempotency DB check error:', e);
    }

    // In-memory idempotency check
    const existingMem = memorySubmissions.find(s => s.idempotencyKey === idempotencyKey.trim());
    if (existingMem) {
      return res.status(200).json({
        success: true,
        status: existingMem.status,
        message: 'Batch weighing already committed to cloud store.',
        submission: existingMem,
        isIdempotentReplay: true,
      });
    }
  }

  // 2. Validate Farm Existence & User Permissions
  let farmName = 'Farm Unit';
  let farmExists = false;

  try {
    if (await checkDb()) {
      const dbFarm = await prisma.farm.findUnique({ where: { id: farmId } });
      if (dbFarm) {
        farmExists = true;
        farmName = dbFarm.name;
      }
    }
  } catch {}

  if (!farmExists) {
    const memFarm = memoryFarms.find(f => f.id === farmId);
    if (memFarm) {
      farmExists = true;
      farmName = memFarm.name;
    }
  }

  if (!farmExists) {
    return res.status(404).json({ error: `Farm with ID "${farmId}" not found.` });
  }

  // Enforce role and farm permissions
  if (!canUserAccessFarm(user, farmId, farmName)) {
    return res.status(403).json({
      error: `Access Denied: Your account (${user.role}) is not assigned to farm "${farmName}".`,
    });
  }

  // 3. Completeness & Hierarchy Validation
  if (!Array.isArray(sheds) || sheds.length === 0) {
    return res.status(400).json({
      error: 'Submission blocked: At least one shed is required.',
      pendingLines: []
    });
  }

  const pendingLines: Array<{ shedName: string; partName: string; lineName: string; path: string }> = [];
  const allWeights: number[] = [];
  const femaleWeights: number[] = [];
  const maleWeights: number[] = [];

  for (const shed of sheds) {
    const shedName = shed.name || 'Shed';
    const isMale = shed.type === 'Male';
    const parts = Array.isArray(shed.parts) ? shed.parts : [];

    if (parts.length === 0) {
      pendingLines.push({
        shedName,
        partName: 'All Parts',
        lineName: 'All Lines',
        path: `${shedName} has no parts defined`
      });
      continue;
    }

    for (const part of parts) {
      const partName = part.name || 'Part';
      const lines = Array.isArray(part.lines) ? part.lines : [];

      if (lines.length === 0) {
        pendingLines.push({
          shedName,
          partName,
          lineName: 'All Lines',
          path: `${shedName} › ${partName} has no lines defined`
        });
        continue;
      }

      for (const line of lines) {
        const lineName = line.name || 'Line';
        const weights = Array.isArray(line.weights) ? line.weights : [];

        if (weights.length === 0) {
          pendingLines.push({
            shedName,
            partName,
            lineName,
            path: `${shedName} › ${partName} › ${lineName}`
          });
        } else {
          for (const w of weights) {
            const num = Number(w);
            if (!Number.isFinite(num) || num <= 0) {
              return res.status(400).json({
                error: `Invalid bird weight: "${w}" in ${shedName} › ${partName} › ${lineName}. Must be a positive number.`
              });
            }
            allWeights.push(num);
            if (isMale) {
              maleWeights.push(num);
            } else {
              femaleWeights.push(num);
            }
          }
        }
      }
    }
  }

  // If any required line is empty, block submission immediately!
  if (pendingLines.length > 0) {
    return res.status(400).json({
      error: `Submission blocked: All required sheds, parts, and lines must have at least one recorded bird weight. (${pendingLines.length} pending line(s))`,
      pendingLines,
      pendingCount: pendingLines.length,
    });
  }

  // 4. Calculate Aggregate Statistics
  const totalBirds = allWeights.length;
  const femaleStats = calculateUniformity(femaleWeights);
  const maleStats = calculateUniformity(maleWeights);
  const overallStats = calculateUniformity(allWeights);

  const femaleAvgWeight = femaleWeights.length > 0 ? femaleStats.avg : null;
  const maleAvgWeight = maleWeights.length > 0 ? maleStats.avg : null;
  const overallAvgWeight = overallStats.avg;
  const uniformity = overallStats.uniformity;

  const now = new Date();
  const effectiveFlockAge = flockAge || 'W18';
  const effectiveSeason = season || 'Summer';

  // 5. Database Transaction (Atomic Commit)
  try {
    if (await checkDb()) {
      const createdSubmission = await prisma.$transaction(async (tx) => {
        // 1. Create Submission record
        const sub = await tx.submission.create({
          data: {
            idempotencyKey: idempotencyKey ? idempotencyKey.trim() : crypto.randomUUID(),
            farmId,
            userId: user.id,
            submitterName: user.name, // Derived from authenticated session!
            submitterRole: user.role, // Derived from authenticated session!
            flockAge: effectiveFlockAge,
            season: effectiveSeason,
            status: 'COMPLETED',
            totalBirds,
            femaleAvgWeight,
            maleAvgWeight,
            overallAvgWeight,
            uniformity,
            metadata: metadata || {},
            submittedAt: now,
          }
        });

        // 2. Save Hierarchy & Individual Bird Weights
        for (let sIdx = 0; sIdx < sheds.length; sIdx++) {
          const s = sheds[sIdx];
          const subShed = await tx.submissionShed.create({
            data: {
              submissionId: sub.id,
              shedId: s.id || null,
              name: s.name,
              type: s.type || 'Female',
              order: sIdx + 1,
            }
          });

          const parts = Array.isArray(s.parts) ? s.parts : [];
          for (let pIdx = 0; pIdx < parts.length; pIdx++) {
            const p = parts[pIdx];
            const subPart = await tx.submissionPart.create({
              data: {
                submissionShedId: subShed.id,
                partId: p.id || null,
                name: p.name,
                order: pIdx + 1,
              }
            });

            const lines = Array.isArray(p.lines) ? p.lines : [];
            for (const l of lines) {
              const lineWeights: number[] = l.weights || [];
              const lineAvg = lineWeights.length > 0
                ? Math.round(lineWeights.reduce((a, b) => a + b, 0) / lineWeights.length)
                : 0;

              const subLine = await tx.submissionLine.create({
                data: {
                  submissionPartId: subPart.id,
                  lineId: l.id ? String(l.id) : null,
                  name: l.name,
                  weights: lineWeights,
                  birdCount: lineWeights.length,
                  avgWeight: lineAvg,
                }
              });

              // Save EVERY individual bird weight with sample sequence!
              for (let wIdx = 0; wIdx < lineWeights.length; wIdx++) {
                await tx.birdWeight.create({
                  data: {
                    submissionId: sub.id,
                    submissionLineId: subLine.id,
                    farmId,
                    shedName: s.name,
                    partName: p.name,
                    lineName: l.name,
                    sex: s.type || 'Female',
                    sampleSequence: wIdx + 1,
                    weightGrams: lineWeights[wIdx],
                    createdAt: now,
                  }
                });
              }
            }
          }
        }

        // 3. Update Farm's last submission metadata
        await tx.farm.update({
          where: { id: farmId },
          data: {
            updatedAt: now,
            ageWeek: effectiveFlockAge,
            season: effectiveSeason,
          }
        });

        // 4. Create Activity Log
        const logAction = `Batch Weighing Submitted • ${totalBirds} Birds (♀ Act: ${femaleAvgWeight ? femaleAvgWeight + 'g' : 'N/A'}, ♂ Act: ${maleAvgWeight ? maleAvgWeight + 'g' : 'N/A'})`;
        await tx.activityLog.create({
          data: {
            farmId,
            userId: user.id,
            userName: `${user.name} (${user.role})`,
            action: logAction,
            sampleCount: totalBirds,
            avgWeight: overallAvgWeight,
            status: 'COMPLETED',
            createdAt: now,
          }
        });

        return sub;
      });

      return res.status(201).json({
        success: true,
        status: 'COMPLETED',
        message: 'Batch weighing submitted and committed to PostgreSQL cloud database successfully.',
        submission: createdSubmission,
        stats: {
          totalBirds,
          femaleAvgWeight,
          maleAvgWeight,
          overallAvgWeight,
          uniformity,
          submittedAt: now.toISOString(),
          submitterName: user.name,
          submitterRole: user.role,
        }
      });
    }
  } catch (dbErr: any) {
    console.error('Database transaction error during submission:', dbErr);
    return res.status(500).json({
      error: 'Failed to commit submission to cloud database. Transaction rolled back; your local draft is preserved.',
      details: dbErr?.message || 'Database transaction error'
    });
  }

  // Fallback: In-Memory Store transaction simulation
  const submissionId = `sub-${crypto.randomUUID()}`;
  const memSubmission: MemSubmission = {
    id: submissionId,
    idempotencyKey: idempotencyKey ? idempotencyKey.trim() : null,
    farmId,
    farmName,
    userId: user.id,
    submitterName: user.name,
    submitterRole: user.role,
    flockAge: effectiveFlockAge,
    season: effectiveSeason,
    status: 'COMPLETED',
    totalBirds,
    femaleAvgWeight,
    maleAvgWeight,
    overallAvgWeight,
    uniformity,
    metadata: metadata || {},
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    sheds,
  };

  // Record individual bird weights in memory
  for (const s of sheds) {
    const parts = Array.isArray(s.parts) ? s.parts : [];
    for (const p of parts) {
      const lines = Array.isArray(p.lines) ? p.lines : [];
      for (const l of lines) {
        const weights: number[] = l.weights || [];
        for (let i = 0; i < weights.length; i++) {
          memoryBirdWeights.push({
            id: `bw-${crypto.randomUUID()}`,
            submissionId,
            submissionLineId: String(l.id || `line-${i}`),
            farmId,
            shedName: s.name,
            partName: p.name,
            lineName: l.name,
            sex: s.type || 'Female',
            sampleSequence: i + 1,
            weightGrams: weights[i],
            createdAt: now,
          });
        }
      }
    }
  }

  memorySubmissions.unshift(memSubmission);

  // Update memory farm
  const memFarm = memoryFarms.find(f => f.id === farmId);
  if (memFarm) {
    memFarm.updatedAt = now;
    memFarm.status = 'COMPLETED';
    memFarm.progressPercentage = 100;
  }

  // Record memory log
  memoryLogs.unshift({
    id: `log-${Date.now()}`,
    farmId,
    farmName,
    userId: user.id,
    userName: `${user.name} (${user.role})`,
    action: `Batch Weighing Submitted • ${totalBirds} Birds (♀ Act: ${femaleAvgWeight ? femaleAvgWeight + 'g' : 'N/A'}, ♂ Act: ${maleAvgWeight ? maleAvgWeight + 'g' : 'N/A'})`,
    sampleCount: totalBirds,
    avgWeight: overallAvgWeight || undefined,
    status: 'COMPLETED',
    createdAt: now,
  });

  return res.status(201).json({
    success: true,
    status: 'COMPLETED',
    message: 'Batch weighing submitted and committed successfully.',
    submission: memSubmission,
    stats: {
      totalBirds,
      femaleAvgWeight,
      maleAvgWeight,
      overallAvgWeight,
      uniformity,
      submittedAt: now.toISOString(),
      submitterName: user.name,
      submitterRole: user.role,
    }
  });
});

// --------------------------------------------------------------------------
// 2. GET /api/submissions - Retrieve all submissions (Filtered by user permissions)
// --------------------------------------------------------------------------
submissionRouter.get('/submissions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const farmId = req.query.farmId as string;

  try {
    if (await checkDb()) {
      const whereClause: any = {};

      if (farmId) {
        if (!canUserAccessFarm(user, farmId)) {
          return res.status(403).json({ error: 'Access denied to this farm.' });
        }
        whereClause.farmId = farmId;
      } else if (user.role !== 'Admin' && user.role !== 'Manager' && !user.assignedFarms.includes('*')) {
        // Find farms accessible to this user
        const accessibleFarms = await prisma.farm.findMany({
          where: {
            OR: [
              { id: { in: user.assignedFarms } },
              { name: { in: user.assignedFarms } },
            ]
          },
          select: { id: true }
        });
        whereClause.farmId = { in: accessibleFarms.map(f => f.id) };
      }

      const submissions = await prisma.submission.findMany({
        where: whereClause,
        orderBy: { submittedAt: 'desc' },
        include: {
          farm: {
            select: { name: true }
          },
          _count: {
            select: {
              sheds: true,
              birdWeights: true,
            }
          }
        }
      });

      return res.json(submissions);
    }
  } catch (err) {
    console.warn('Prisma get /submissions error, falling back to memory:', err);
  }

  // Memory fallback
  let filtered = memorySubmissions.slice();
  if (farmId) {
    if (!canUserAccessFarm(user, farmId)) {
      return res.status(403).json({ error: 'Access denied to this farm.' });
    }
    filtered = filtered.filter(s => s.farmId === farmId);
  } else if (user.role !== 'Admin' && user.role !== 'Manager' && !user.assignedFarms.includes('*')) {
    filtered = filtered.filter(s => canUserAccessFarm(user, s.farmId, s.farmName));
  }

  return res.json(filtered);
});

// --------------------------------------------------------------------------
// 3. GET /api/submissions/:id - Get full submission details with hierarchy
// --------------------------------------------------------------------------
submissionRouter.get('/submissions/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const submissionId = req.params.id;

  try {
    if (await checkDb()) {
      const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        include: {
          farm: true,
          sheds: {
            orderBy: { order: 'asc' },
            include: {
              parts: {
                orderBy: { order: 'asc' },
                include: {
                  lines: true
                }
              }
            }
          },
          _count: {
            select: { birdWeights: true }
          }
        }
      });

      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      if (!canUserAccessFarm(user, submission.farmId, submission.farm.name)) {
        return res.status(403).json({ error: 'Access denied: You are not authorized to view this submission.' });
      }

      return res.json(submission);
    }
  } catch (err) {
    console.warn('Prisma get /submissions/:id error, fallback to memory:', err);
  }

  const memSub = memorySubmissions.find(s => s.id === submissionId);
  if (!memSub) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  if (!canUserAccessFarm(user, memSub.farmId, memSub.farmName)) {
    return res.status(403).json({ error: 'Access denied: You are not authorized to view this submission.' });
  }

  return res.json(memSub);
});

// --------------------------------------------------------------------------
// 4. GET /api/submissions/:id/birds - Get individual bird weights
// --------------------------------------------------------------------------
submissionRouter.get('/submissions/:id/birds', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const submissionId = req.params.id;
  const { shedName, partName, lineName, sex } = req.query;

  try {
    if (await checkDb()) {
      const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { farmId: true }
      });
      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }
      if (!canUserAccessFarm(user, submission.farmId)) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const whereClause: any = { submissionId };
      if (shedName) whereClause.shedName = String(shedName);
      if (partName) whereClause.partName = String(partName);
      if (lineName) whereClause.lineName = String(lineName);
      if (sex) whereClause.sex = String(sex);

      const birds = await prisma.birdWeight.findMany({
        where: whereClause,
        orderBy: [
          { shedName: 'asc' },
          { partName: 'asc' },
          { lineName: 'asc' },
          { sampleSequence: 'asc' },
        ]
      });

      return res.json(birds);
    }
  } catch (err) {
    console.warn('Prisma get /birds error, fallback to memory:', err);
  }

  const birds = memoryBirdWeights.filter(b => {
    if (b.submissionId !== submissionId) return false;
    if (shedName && b.shedName !== shedName) return false;
    if (partName && b.partName !== partName) return false;
    if (lineName && b.lineName !== lineName) return false;
    if (sex && b.sex !== sex) return false;
    return true;
  });

  return res.json(birds);
});

// --------------------------------------------------------------------------
// 5. GET /api/farms/:farmId/submissions - Get submissions for specific farm
// --------------------------------------------------------------------------
submissionRouter.get('/farms/:farmId/submissions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const farmId = req.params.farmId;

  if (!canUserAccessFarm(user, farmId)) {
    return res.status(403).json({ error: 'Access denied to this farm.' });
  }

  try {
    if (await checkDb()) {
      const submissions = await prisma.submission.findMany({
        where: { farmId },
        orderBy: { submittedAt: 'desc' },
        include: {
          _count: {
            select: { birdWeights: true, sheds: true }
          }
        }
      });
      return res.json(submissions);
    }
  } catch (err) {
    console.warn('Prisma get /farms/:farmId/submissions error, fallback to memory:', err);
  }

  const memList = memorySubmissions.filter(s => s.farmId === farmId);
  return res.json(memList);
});
