import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { isPostgresConfigured } from '../db/init.js';

export const healthRouter = Router();

async function isDatabaseHealthy(): Promise<boolean> {
  if (!isPostgresConfigured()) {
    // Operating in offline/in-memory mode
    return true;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err: any) {
    console.error('[Health Check DB Ping Failed]:', err?.message || err);
    return false;
  }
}

// 1. Neutral Standardized Health Check Endpoints
// Returns strictly minimal status without printing database connection latency, hostnames, IP addresses, schema details, or versions.
const healthHandler = async (_req: Request, res: Response) => {
  const healthy = await isDatabaseHealthy();
  if (healthy) {
    return res.status(200).json({ status: 'ok' });
  }
  return res.status(503).json({ status: 'unavailable' });
};

healthRouter.get('/healthz', healthHandler);
healthRouter.get('/health', healthHandler);
healthRouter.get('/api/healthz', healthHandler);
healthRouter.get('/api/health', healthHandler);

// 2. Masked Health Diagnostic Endpoints (Zero stack or database disclosure)
healthRouter.get('/api/health/db', healthHandler);
healthRouter.get('/health/db', healthHandler);

// 3. Masked Database Sync Endpoint
healthRouter.post('/api/health/db-sync', async (_req: Request, res: Response) => {
  const healthy = await isDatabaseHealthy();
  if (healthy) {
    return res.status(200).json({ status: 'ok' });
  }
  return res.status(503).json({
    status: 503,
    message: 'An unexpected error occurred. Please try again later.',
  });
});
