import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { inspectDatabase, syncDatabaseSchema, isPostgresConfigured, REQUIRED_TABLES } from '../db/init.js';

export const healthRouter = Router();

async function checkDatabase() {
  const start = Date.now();
  const configured = isPostgresConfigured();

  if (!configured) {
    return {
      connected: false,
      latencyMs: 0,
      configured: false,
      provider: 'sqlite-or-in-memory',
      message: 'PostgreSQL DATABASE_URL not configured. Operating in local simulation / offline mode.',
      fallback: 'in-memory-simulation-store',
    };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      connected: true,
      latencyMs: Date.now() - start,
      configured: true,
      provider: 'postgresql',
      message: 'PostgreSQL connection active',
      fallback: null,
    };
  } catch (err: any) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      configured: true,
      provider: 'postgresql',
      error: err?.message || 'Database unreachable',
      fallback: 'in-memory-simulation-store',
    };
  }
}

let lastInspection: any = null;
let lastInspectionTime = 0;

// 1. General health check handlers (/healthz, /health, /api/healthz, /api/health)
const healthHandler = async (req: Request, res: Response) => {
  const db = await checkDatabase();
  const now = Date.now();
  const shouldFullInspect = req.query.full === 'true' || (now - lastInspectionTime > 60000);

  let inspection = lastInspection;
  if (!inspection || shouldFullInspect) {
    if (db.connected) {
      inspection = await inspectDatabase().catch(() => null);
      if (inspection) {
        lastInspection = inspection;
        lastInspectionTime = now;
      }
    }
  }

  const payload = {
    status: db.connected ? 'healthy' : 'degraded',
    service: 'poultry-weight-backend',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: db.connected ? 'connected' : 'disconnected',
      provider: db.provider,
      latencyMs: db.latencyMs,
      configured: db.configured,
      message: db.connected ? 'Server is connected' : 'Server is not connected',
      schemaReady: inspection?.allRequiredExist ?? db.connected,
    },
    syncCapabilities: {
      multiFarm: true,
      realtimeLogs: true,
      offlineQueueResilient: true,
      idempotentRetries: true,
    },
  };
  return res.status(200).json(payload);
};

healthRouter.get('/healthz', healthHandler);
healthRouter.get('/health', healthHandler);
healthRouter.get('/api/healthz', healthHandler);
healthRouter.get('/api/health', healthHandler);

// 2. Dedicated Database Schema Inspection Endpoint (/api/health/db)
const dbHealthHandler = async (_req: Request, res: Response) => {
  const start = Date.now();
  const inspection = await inspectDatabase();
  const latencyMs = Date.now() - start;

  if (inspection.connected) {
    return res.status(200).json({
      status: inspection.allRequiredExist ? 'ready' : 'missing_tables',
      provider: 'postgresql',
      latencyMs,
      allTablesReady: inspection.allRequiredExist,
      requiredTablesTotal: REQUIRED_TABLES.length,
      existingTables: inspection.existingTables,
      missingTables: inspection.missingTables,
      counts: {
        farms: inspection.farmCount,
        users: inspection.userCount,
        submissions: inspection.submissionCount,
        birdWeights: inspection.birdWeightCount,
        activityLogs: inspection.activityLogCount,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(503).json({
    status: 'disconnected',
    configured: inspection.isPostgres,
    error: inspection.error || 'Unable to connect to database',
    requiredTables: REQUIRED_TABLES,
    hint: 'Verify DATABASE_URL in Render Dashboard settings.',
  });
};

healthRouter.get('/api/health/db', dbHealthHandler);
healthRouter.get('/health/db', dbHealthHandler);

// 3. Manual Schema Push Trigger Endpoint (/api/health/db-sync)
healthRouter.post('/api/health/db-sync', async (_req: Request, res: Response) => {
  try {
    const result = await syncDatabaseSchema();
    if (result.success) {
      return res.status(200).json(result);
    }
    return res.status(500).json(result);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Database sync failed',
    });
  }
});
