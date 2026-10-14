import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { healthRouter } from './routes/healthz.js';
import { farmRouter } from './routes/farms.js';
import { submissionRouter } from './routes/submissions.js';
import { benchmarkRouter } from './routes/benchmarks.js';
import { exportRouter } from './routes/export.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Middlewares
app.use(cors({
  origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json({ limit: '10mb' }));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/healthz' && req.path !== '/health') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// 1. Health check & Diagnostics Routers (Handles /healthz, /health, /api/healthz, /api/health, /api/health/db)
app.use(healthRouter);

// 2. Multi-Farm Cloud Routes & Submissions (Mounted on /api and aliased on root)
app.use('/api', farmRouter);
app.use('/', farmRouter);
app.use('/api', submissionRouter);
app.use('/', submissionRouter);

// 3. Benchmarks & Export Routers
app.use('/api/benchmarks', benchmarkRouter);
app.use('/benchmarks', benchmarkRouter);
app.use('/api/export', exportRouter);
app.use('/export', exportRouter);

// 4. Root information endpoint
const rootHandler = (_req: Request, res: Response) => {
  res.json({
    name: 'Poultry Body Weight Tracker - Multi-Farm Real-Time Cloud API',
    status: 'online',
    version: '3.0.0',
    documentation: '/healthz',
    healthCheck: '/healthz',
    databaseCheck: '/api/health/db',
    apiPrefix: '/api',
    endpoints: [
      'GET    /healthz (or /api/health)',
      'GET    /api/health/db',
      'GET    /api/farms',
      'POST   /api/farms',
      'GET    /api/farms/:id',
      'PUT    /api/farms/:id/details',
      'DELETE /api/farms/:id',
      'PUT    /api/farms/:id/sync',
      'POST   /api/sheds',
      'DELETE /api/sheds/:shedId',
      'PUT    /api/sheds/:shedId',
      'POST   /api/parts',
      'DELETE /api/parts/:partId',
      'PUT    /api/parts/:partId',
      'POST   /api/lines',
      'DELETE /api/lines/:lineId',
      'POST   /api/lines/:lineId/weight',
      'DELETE /api/lines/:lineId/weight/:index',
      'POST   /api/lines/:lineId/clear',
      'POST   /api/auth/register',
      'POST   /api/auth/login',
      'GET    /api/auth/users',
      'GET    /api/logs',
      'POST   /api/logs',
      'GET    /api/benchmarks'
    ]
  });
};

app.get('/', rootHandler);
app.get('/api', rootHandler);

// Start server if not running in test mode
let server: any = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Poultry Sync Server running on http://${HOST}:${PORT}`);
    console.log(`📡 Health check available at http://${HOST}:${PORT}/healthz`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    if (server) {
      server.close(() => {
        console.log('HTTP server closed');
      });
    }
  });
}

export default app;
