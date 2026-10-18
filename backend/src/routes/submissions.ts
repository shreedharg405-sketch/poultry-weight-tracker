import { Router, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db/prisma.js';
import { requireAuth, canUserAccessFarm, AuthenticatedRequest } from '../middleware/auth.js';
import { memoryFarms, memoryLogs } from './farms.js';
import { isPostgresConfigured } from '../db/init.js';

export const submissionRouter = Router();

// In-Memory store for submissions and bird weights ONLY when PostgreSQL is not configured (offline dev)
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
    const cleanKey = idempotencyKey.trim();

    if (isPostgresConfigured()) {
      try {
        const existing = await prisma.submission.findUnique({
          where: { idempotencyKey: cleanKey },
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
            message: 'Batch weighing already committed.',
            submission: existing,
            isIdempotentReplay: true,
          });
        }
      } catch (e: any) {
        console.error('❌ [DB] Idempotency check error:', e?.message || e);
        return res.status(503).json({
          error: 'Server is not connected',
          details: 'Server is not connected',
        });
      }
    } else {
      const existingMem = memorySubmissions.find(s => s.idempotencyKey === cleanKey);
      if (existingMem) {
        return res.status(200).json({
          success: true,
          status: existingMem.status,
          message: 'Batch weighing already committed.',
          submission: existingMem,
          isIdempotentReplay: true,
        });
      }
    }
  }

  // 2. Validate Farm Existence & User Permissions
  let farmName = 'Farm Unit';
  let farmExists = false;

  if (isPostgresConfigured()) {
    try {
      const dbFarm = await prisma.farm.findUnique({ where: { id: farmId } });
      if (dbFarm) {
        farmExists = true;
        farmName = dbFarm.name;
      }
    } catch (e: any) {
      console.error('❌ [DB] Farm existence check error:', e?.message || e);
      return res.status(503).json({
        error: 'Server is not connected',
        details: 'Server is not connected',
      });
    }
  } else {
    const memFarm = memoryFarms.find(f => f.id === farmId);
    if (memFarm) {
      farmExists = true;
      farmName = memFarm.name;
    }
  }

  if (!farmExists) {
    return res.status(404).json({ error: `Farm with ID "${farmId}" not found in database.` });
  }

  // Enforce role and farm permissions
  if (!canUserAccessFarm(user, farmId, farmName)) {
    return res.status(403).json({
      error: `Access Denied: Your account (${user.role}) is not assigned to farm "${farmName}".`,
    });
  }

  // 3. Completeness & Hierarchy Validation: Query real configured sheds for this farm
  let configuredSheds: any[] = [];
  if (isPostgresConfigured()) {
    try {
      configuredSheds = await prisma.shed.findMany({
        where: { farmId },
        include: {
          parts: {
            include: { lines: true },
            orderBy: { order: 'asc' }
          }
        },
        orderBy: { order: 'asc' }
      });
    } catch (e: any) {
      console.warn('Could not query configured sheds for completeness check:', e);
    }
  } else {
    const mem = memoryFarms.find(f => f.id === farmId);
    configuredSheds = (mem as any)?.sheds || [];
  }

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

  // If the farm has configured sheds in database, ensure EVERY configured shed is present and complete
  if (configuredSheds.length > 0) {
    for (const confShed of configuredSheds) {
      const submittedShed = sheds.find((s: any) => 
        (s.id && s.id === confShed.id) || 
        (s.name && confShed.name && s.name.trim().toLowerCase() === confShed.name.trim().toLowerCase())
      );

      if (!submittedShed) {
        pendingLines.push({
          shedName: confShed.name,
          partName: 'All Parts',
          lineName: 'All Lines',
          path: `${confShed.name} has not been weighed yet`
        });
        continue;
      }

      const confParts = Array.isArray(confShed.parts) ? confShed.parts : [];
      if (confParts.length === 0) {
        // If DB shed had 0 parts, verify submitted shed provided at least 1 part with lines
        const subParts = Array.isArray(submittedShed.parts) ? submittedShed.parts : [];
        if (subParts.length === 0) {
          pendingLines.push({
            shedName: confShed.name,
            partName: 'Part A',
            lineName: 'Line 1',
            path: `${confShed.name} has no parts or lines configured`
          });
        }
      }
    }
  }

  // Validate all lines in submitted sheds for >= 10 birds and valid gender
  for (const shed of sheds) {
    const shedName = shed.name || 'Shed';
    const isMale = shed.type === 'Male';
    const isFemale = shed.type === 'Female';

    if (!isMale && !isFemale) {
      pendingLines.push({
        shedName,
        partName: 'Configuration',
        lineName: 'Gender',
        path: `${shedName} requires a valid Female or Male selection`
      });
    }

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

        // Poultry standard: A line must have at least 10 valid bird weights to be complete
        if (weights.length < 10) {
          pendingLines.push({
            shedName,
            partName,
            lineName,
            path: `${shedName} › ${partName} › ${lineName} (has ${weights.length} of 10 required birds)`
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

  // If any required line is incomplete, block submission immediately!
  if (pendingLines.length > 0) {
    return res.status(400).json({
      error: `Submission blocked: All configured sheds and lines must be completed with at least 10 bird weights. (${pendingLines.length} incomplete line(s))`,
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
  if (isPostgresConfigured()) {
    try {
      const createdSubmission = await prisma.$transaction(async (tx) => {
        // 1. Create Submission record
        const sub = await tx.submission.create({
          data: {
            idempotencyKey: idempotencyKey ? idempotencyKey.trim() : crypto.randomUUID(),
            farmId,
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

              // Batch insert individual bird weights for high speed
              if (lineWeights.length > 0) {
                const birdRecords = lineWeights.map((w, wIdx) => ({
                  submissionId: sub.id,
                  submissionLineId: subLine.id,
                  farmId,
                  shedName: s.name,
                  partName: p.name,
                  lineName: l.name,
                  sex: s.type || 'Female',
                  sampleSequence: wIdx + 1,
                  weightGrams: w,
                  createdAt: now,
                }));
                await tx.birdWeight.createMany({ data: birdRecords });
              }

              // Update active line structure if exists
              if (l.id) {
                try {
                  await tx.line.update({
                    where: { id: String(l.id) },
                    data: { weights: lineWeights }
                  });
                } catch {
                  try {
                    const foundLine = await tx.line.findFirst({
                      where: {
                        name: l.name,
                        part: { name: p.name, shed: { farmId, name: s.name } }
                      }
                    });
                    if (foundLine) {
                      await tx.line.update({
                        where: { id: foundLine.id },
                        data: { weights: lineWeights }
                      });
                    }
                  } catch {}
                }
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
        message: 'Batch weighing submitted and committed to cloud database successfully.',
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
    } catch (dbErr: any) {
      console.error('❌ [DB] Database transaction error during submission:', dbErr);

      // Check if duplicate submission conflict occurred
      if (dbErr?.code === 'P2002' && idempotencyKey) {
        try {
          const existing = await prisma.submission.findUnique({
            where: { idempotencyKey: idempotencyKey.trim() },
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
        } catch {}
      }

      console.error('❌ [DB] Error committing submission:', dbErr?.message || dbErr);
      return res.status(500).json({
        status: 500,
        message: 'An unexpected error occurred. Please try again later.',
        error: 'Failed to commit submission. Transaction rolled back; your local draft is preserved.',
      });
    }
  }

  // Fallback ONLY for local offline simulation without PostgreSQL
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

  const memFarm = memoryFarms.find(f => f.id === farmId || f.name === farmName);
  if (memFarm) {
    memFarm.sheds = sheds;
    memFarm.updatedAt = now;
    memFarm.status = 'COMPLETED';
    memFarm.progressPercentage = 100;
    memFarm.audit = {
      status: 'COMPLETED',
      lastSubmittedAt: now.toISOString(),
      lastSubmittedBy: user.name,
      lastSubmittedRole: user.role,
      submittedBy: user.name,
      submittedRole: user.role,
      totalBirdsSubmitted: totalBirds,
      femaleAvgWeight,
      maleAvgWeight,
    };
  }

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
    message: 'Batch weighing submitted and committed to local store.',
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

  if (isPostgresConfigured()) {
    try {
      const whereClause: any = {};

      if (farmId) {
        if (!canUserAccessFarm(user, farmId)) {
          return res.status(403).json({ error: 'Access denied to this farm.' });
        }
        whereClause.farmId = farmId;
      } else if (user.role !== 'Admin' && user.role !== 'Manager' && !user.assignedFarms.includes('*')) {
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
            select: {
              sheds: true,
              birdWeights: true,
            }
          }
        }
      });

      return res.json(submissions);
    } catch (err: any) {
      console.error('❌ [DB] Error in get /submissions:', err?.message || err);
      return res.status(503).json({
        error: 'Server is not connected',
        details: 'Server is not connected',
      });
    }
  }

  // Offline memory fallback
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

  if (isPostgresConfigured()) {
    try {
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
    } catch (err: any) {
      console.error('❌ [DB] Error in get /submissions/:id:', err?.message || err);
      return res.status(503).json({
        error: 'Server is not connected',
        details: 'Server is not connected',
      });
    }
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

  if (isPostgresConfigured()) {
    try {
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
    } catch (err: any) {
      console.error('❌ [DB] Error in get /birds:', err?.message || err);
      return res.status(503).json({
        error: 'Server is not connected',
        details: 'Server is not connected',
      });
    }
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

  const queryWeek = (req.query.week || req.query.flockAge) as string | undefined;
  const targetWeek = queryWeek ? queryWeek.trim().toUpperCase() : undefined;

  if (isPostgresConfigured()) {
    try {
      const submissions = await prisma.submission.findMany({
        where: {
          farmId,
          ...(targetWeek && { flockAge: targetWeek })
        },
        orderBy: { submittedAt: 'desc' },
        include: {
          _count: {
            select: { birdWeights: true, sheds: true }
          }
        }
      });
      return res.json(submissions);
    } catch (err: any) {
      console.error('❌ [DB] Error in get farm submissions:', err?.message || err);
      return res.status(503).json({
        error: 'Server is not connected',
        details: 'Server is not connected',
      });
    }
  }

  const memList = memorySubmissions.filter(s =>
    s.farmId === farmId && (!targetWeek || s.flockAge?.trim().toUpperCase() === targetWeek)
  );
  return res.json(memList);
});

// --------------------------------------------------------------------------
// 6. PUT /api/submissions/:id - Update an existing submission (Req 2)
// --------------------------------------------------------------------------
submissionRouter.put('/submissions/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const submissionId = req.params.id;
  const { flockAge, season, status, sheds, metadata } = req.body;

  if (isPostgresConfigured()) {
    try {
      const existing = await prisma.submission.findUnique({
        where: { id: submissionId },
        include: { farm: true }
      });

      if (!existing) {
        return res.status(404).json({ error: 'Submission not found in database' });
      }

      if (!canUserAccessFarm(user, existing.farmId, existing.farm.name)) {
        return res.status(403).json({ error: 'Access denied: You are not authorized to update this submission.' });
      }

      let totalBirds = existing.totalBirds;
      let femaleAvgWeight = existing.femaleAvgWeight;
      let maleAvgWeight = existing.maleAvgWeight;
      let overallAvgWeight = existing.overallAvgWeight;
      let uniformity = existing.uniformity;

      if (Array.isArray(sheds) && sheds.length > 0) {
        const allWeights: number[] = [];
        const femaleWeights: number[] = [];
        const maleWeights: number[] = [];

        sheds.forEach((shed: any) => {
          const isMale = shed.type === 'Male';
          (shed.parts || []).forEach((part: any) => {
            (part.lines || []).forEach((line: any) => {
              const weights = Array.isArray(line.weights) ? line.weights.map(Number).filter((w: number) => !isNaN(w) && w > 0) : [];
              allWeights.push(...weights);
              if (isMale) maleWeights.push(...weights);
              else femaleWeights.push(...weights);
            });
          });
        });

        totalBirds = allWeights.length;
        overallAvgWeight = allWeights.length ? Math.round(allWeights.reduce((a, b) => a + b, 0) / allWeights.length) : null;
        femaleAvgWeight = femaleWeights.length ? Math.round(femaleWeights.reduce((a, b) => a + b, 0) / femaleWeights.length) : null;
        maleAvgWeight = maleWeights.length ? Math.round(maleWeights.reduce((a, b) => a + b, 0) / maleWeights.length) : null;
        const uRes = calculateUniformity(allWeights);
        uniformity = uRes.uniformity;

        await prisma.$transaction(async (tx) => {
          await tx.birdWeight.deleteMany({ where: { submissionId } });
          await tx.submissionShed.deleteMany({ where: { submissionId } });

          for (let sIdx = 0; sIdx < sheds.length; sIdx++) {
            const s = sheds[sIdx];
            const createdShed = await tx.submissionShed.create({
              data: {
                submissionId,
                name: s.name || `Shed ${sIdx + 1}`,
                type: s.type || 'Female',
                order: s.order ?? sIdx + 1,
              }
            });

            for (let pIdx = 0; pIdx < (s.parts || []).length; pIdx++) {
              const p = s.parts[pIdx];
              const createdPart = await tx.submissionPart.create({
                data: {
                  submissionShedId: createdShed.id,
                  name: p.name || `Part ${String.fromCharCode(65 + pIdx)}`,
                  order: p.order ?? pIdx + 1,
                }
              });

              for (let lIdx = 0; lIdx < (p.lines || []).length; lIdx++) {
                const l = p.lines[lIdx];
                const cleanWeights = Array.isArray(l.weights) ? l.weights.map(Number).filter((w: number) => !isNaN(w) && w > 0) : [];
                const lineAvg = cleanWeights.length ? Math.round(cleanWeights.reduce((a: number, b: number) => a + b, 0) / cleanWeights.length) : null;

                const createdLine = await tx.submissionLine.create({
                  data: {
                    submissionPartId: createdPart.id,
                    name: l.name || `Line ${lIdx + 1}`,
                    weights: cleanWeights,
                    birdCount: cleanWeights.length,
                    avgWeight: lineAvg,
                  }
                });

                if (cleanWeights.length > 0) {
                  await tx.birdWeight.createMany({
                    data: cleanWeights.map((w: number, wIdx: number) => ({
                      submissionId,
                      submissionLineId: createdLine.id,
                      farmId: existing.farmId,
                      shedName: s.name,
                      partName: p.name,
                      lineName: l.name,
                      sex: s.type || 'Female',
                      sampleSequence: wIdx + 1,
                      weightGrams: w,
                    }))
                  });
                }
              }
            }
          }
        });
      }

      const updated = await prisma.submission.update({
        where: { id: submissionId },
        data: {
          flockAge: flockAge || existing.flockAge,
          season: season || existing.season,
          status: status || existing.status,
          totalBirds,
          femaleAvgWeight,
          maleAvgWeight,
          overallAvgWeight,
          uniformity,
          metadata: metadata !== undefined ? metadata : existing.metadata,
        },
        include: {
          farm: true,
          sheds: {
            orderBy: { order: 'asc' },
            include: {
              parts: {
                orderBy: { order: 'asc' },
                include: { lines: true }
              }
            }
          }
        }
      });

      return res.json({
        success: true,
        message: 'Submission updated successfully',
        submission: updated
      });
    } catch (err: any) {
      console.error('❌ [DB] Error in update submission:', err?.message || err);
      return res.status(503).json({
        error: 'Server is not connected',
        details: 'Server is not connected',
      });
    }
  }

  // In-Memory store fallback
  const memSub = memorySubmissions.find(s => s.id === submissionId);
  if (!memSub) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  if (!canUserAccessFarm(user, memSub.farmId, memSub.farmName)) {
    return res.status(403).json({ error: 'Access denied: You are not authorized to update this submission.' });
  }

  if (flockAge) memSub.flockAge = flockAge;
  if (season) memSub.season = season;
  if (status) memSub.status = status;
  if (metadata !== undefined) memSub.metadata = metadata;
  memSub.updatedAt = new Date();

  if (Array.isArray(sheds) && sheds.length > 0) {
    memSub.sheds = sheds;

    for (let i = memoryBirdWeights.length - 1; i >= 0; i--) {
      if (memoryBirdWeights[i].submissionId === submissionId) {
        memoryBirdWeights.splice(i, 1);
      }
    }

    const allWeights: number[] = [];
    const femaleWeights: number[] = [];
    const maleWeights: number[] = [];

    sheds.forEach(s => {
      const isMale = s.type === 'Male';
      (s.parts || []).forEach((p: any) => {
        (p.lines || []).forEach((l: any) => {
          const weights = Array.isArray(l.weights) ? l.weights.map(Number).filter((w: number) => !isNaN(w) && w > 0) : [];
          allWeights.push(...weights);
          if (isMale) maleWeights.push(...weights);
          else femaleWeights.push(...weights);

          weights.forEach((w: number, wIdx: number) => {
            memoryBirdWeights.push({
              id: crypto.randomUUID(),
              submissionId,
              submissionLineId: l.id || crypto.randomUUID(),
              farmId: memSub.farmId,
              shedName: s.name,
              partName: p.name,
              lineName: l.name,
              sex: s.type || 'Female',
              sampleSequence: wIdx + 1,
              weightGrams: w,
              createdAt: new Date(),
            });
          });
        });
      });
    });

    memSub.totalBirds = allWeights.length;
    memSub.overallAvgWeight = allWeights.length ? Math.round(allWeights.reduce((a, b) => a + b, 0) / allWeights.length) : null;
    memSub.femaleAvgWeight = femaleWeights.length ? Math.round(femaleWeights.reduce((a, b) => a + b, 0) / femaleWeights.length) : null;
    memSub.maleAvgWeight = maleWeights.length ? Math.round(maleWeights.reduce((a, b) => a + b, 0) / maleWeights.length) : null;
    const uRes = calculateUniformity(allWeights);
    memSub.uniformity = uRes.uniformity;
  }

  return res.json({
    success: true,
    message: 'Submission updated successfully',
    submission: memSub
  });
});

