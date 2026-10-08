import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';

export const healthRouter = Router();

healthRouter.get('/healthz', async (req: Request, res: Response) => {
  let dbStatus = 'healthy';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'degraded';
  }

  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbStatus,
    service: 'poultry-bodyweight-api',
  });
});
