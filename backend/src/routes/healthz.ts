import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';

export const healthRouter = Router();

async function checkDatabase() {
  const start = Date.now();
  const dbUrlConfigured = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
  try {
    if (!dbUrlConfigured) {
      return {
        connected: false,
        latencyMs: 0,
        configured: false,
        message: 'DATABASE_URL environment variable is missing or empty'
      };
    }
    await prisma.$queryRaw`SELECT 1`;
    return {
      connected: true,
      latencyMs: Date.now() - start,
      configured: true,
      provider: 'postgresql',
      message: 'PostgreSQL connection active'
    };
  } catch (err: any) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      configured: dbUrlConfigured,
      provider: 'postgresql',
      error: err?.message || 'Database unreachable',
      fallback: 'in-memory-simulation-store'
    };
  }
}

// Handlers for general server health
const healthHandler = async (_req: Request, res: Response) => {
  const db = await checkDatabase();
  const payload = {
    status: db.connected ? 'healthy' : 'degraded',
    service: 'poultry-weight-backend',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: db.connected ? 'connected' : 'disconnected',
      provider: db.provider || 'unknown',
      latencyMs: db.latencyMs,
      configured: db.configured,
      message: db.message || db.error,
      fallback: db.fallback || null,
    },
    syncCapabilities: {
      multiFarm: true,
      realtimeLogs: true,
      offlineQueueResilient: true
    }
  };
  return res.status(200).json(payload);
};

healthRouter.get('/healthz', healthHandler);
healthRouter.get('/health', healthHandler);
healthRouter.get('/api/healthz', healthHandler);
healthRouter.get('/api/health', healthHandler);

// Dedicated Database Health Endpoint
const dbHealthHandler = async (_req: Request, res: Response) => {
  const db = await checkDatabase();
  if (db.connected) {
    return res.status(200).json({
      status: 'connected',
      provider: 'postgresql',
      latencyMs: db.latencyMs,
      timestamp: new Date().toISOString()
    });
  }
  return res.status(503).json({
    status: 'disconnected',
    configured: db.configured,
    error: db.error || db.message,
    fallback: 'in-memory-store',
    hint: 'Set DATABASE_URL in Render Dashboard to link PostgreSQL'
  });
};

healthRouter.get('/api/health/db', dbHealthHandler);
healthRouter.get('/health/db', dbHealthHandler);
